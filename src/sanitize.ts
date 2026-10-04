/**
 * Sanitização: whitelist explícita, sem arredondar, sem preencher ausentes com zero.
 *
 * Fronteira do commitment (pog.snapshot.v1): SOMENTE os campos abaixo entram no hash.
 * Tudo o mais no export (Commands, LightSchedules, WateringSchedules, estados ON/OFF,
 * lastAutoOn/lastAutoOff, pumpTimeout_seconds, credenciais, identificadores brutos)
 * fica de fora e NÃO é protegido pela prova.
 */
import { createHmac } from "node:crypto";

export const SCHEMA_VERSION = "pog.snapshot.v1" as const;
export const SANITIZER_VERSION = "pog.sanitizer.1.0.0" as const;
export const SOURCE = "thecloudpot.rtdb" as const;
export const DEVICE_ID_RULE = "pog.device.v1" as const;
export const PLANT_COUNT = 6;

export interface PlantReading {
  id: string; // plant-01 .. plant-06
  soilMoisture: number; // valor bruto do sensor; unidade não declarada no export
  temperatureC: number;
}

export interface SnapshotV1 {
  schemaVersion: typeof SCHEMA_VERSION;
  source: typeof SOURCE;
  devicePseudonym: string;
  firmwareVersion: string;
  reportedTimestampRaw: string;
  reportIntervalMin: number;
  soilMoistureUnit: "unspecified";
  plants: PlantReading[];
}

export interface PrivateDeviceContext {
  /** Identificador bruto (ex.: MAC). Nunca sai do backend. */
  deviceId: string;
  /** Segredo HMAC do backend (>= 32 bytes). */
  pseudonymSecret: Uint8Array;
}

/**
 * Caminhos do export (relativos à raiz do conteúdo do dispositivo), conferidos no export real.
 * Campos com lista aceitam candidatos; exatamente um precisa existir (senão: ambíguo).
 */
export const FIELD_PATHS = {
  plantRoot: "RealTimeControl/Status",
  plantKey: (n: number) => `Weed${n}`,
  soilMoisture: "Humidity",
  temperature: "Temperature",
  firmwareVersion: ["Version"], // confirmado no export real: raiz do conteúdo do dispositivo
  reportedTimestamp: ["RealTimeControl/Status/timestamp"],
  reportInterval: ["RealTimeControl/Configs/reportInterval_min"],
} as const;

export const EXCLUDED_FIELDS_DOC = [
  "RealTimeControl/Commands (comandos de controle)",
  "RealTimeControl/LightSchedules e WateringSchedules (agendamentos)",
  "Estados ON/OFF e lastAutoOn/lastAutoOff (operacionais; magnitude de tempo diferente)",
  "RealTimeControl/Configs/pumpTimeout_seconds (configuração operacional)",
  "Identificador bruto do dispositivo (substituído por devicePseudonym via HMAC)",
  "Qualquer outro campo não listado na whitelist",
];

export class SanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SanitizeError";
  }
}

/** Regra versionada pog.device.v1: trim, minúsculas, remove separadores ':', '-', '_', '.', espaços. */
export function normalizeDeviceId(raw: string): string {
  const n = raw.trim().toLowerCase().replace(/[:\-_.\s]/g, "");
  if (!/^[a-z0-9]+$/.test(n)) throw new SanitizeError("Identificador de dispositivo vazio ou com caracteres inválidos");
  return n;
}

export function devicePseudonym(ctx: PrivateDeviceContext): string {
  if (ctx.pseudonymSecret.length < 32) throw new SanitizeError("pseudonymSecret precisa ter pelo menos 32 bytes");
  return createHmac("sha256", ctx.pseudonymSecret)
    .update(`${DEVICE_ID_RULE}|${normalizeDeviceId(ctx.deviceId)}`, "utf8")
    .digest("hex");
}

function getPath(root: unknown, path: string): { found: boolean; value: unknown } {
  let cur: unknown = root;
  for (const part of path.split("/")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !Object.hasOwn(cur, part)) {
      return { found: false, value: undefined };
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return { found: true, value: cur };
}

function pickOne(root: unknown, candidates: readonly string[], label: string): unknown {
  const hits = candidates.map((p) => ({ p, ...getPath(root, p) })).filter((h) => h.found);
  if (hits.length === 0) throw new SanitizeError(`Campo obrigatório ausente: ${label} (procurado em ${candidates.join(", ")})`);
  if (hits.length > 1) {
    throw new SanitizeError(`Campo ambíguo: ${label} aparece em ${hits.map((h) => h.p).join(" e ")}. Fixe o caminho em FIELD_PATHS.`);
  }
  return hits[0]!.value;
}

function requireFiniteNumber(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SanitizeError(`${label} precisa ser número finito (recebido: ${JSON.stringify(v)})`);
  }
  return v;
}

function requireNonEmptyString(v: unknown, label: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new SanitizeError(`${label} precisa ser string não vazia (recebido: ${JSON.stringify(v)})`);
  }
  return v;
}

export function plantId(n: number): string {
  return `plant-${String(n).padStart(2, "0")}`;
}

/** sanitize(raw, privateDeviceContext) -> SnapshotV1 */
export function sanitize(raw: unknown, ctx: PrivateDeviceContext): SnapshotV1 {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SanitizeError("Export precisa ser um objeto JSON");
  }

  const plants: PlantReading[] = [];
  for (let n = 1; n <= PLANT_COUNT; n++) {
    const base = `${FIELD_PATHS.plantRoot}/${FIELD_PATHS.plantKey(n)}`;
    const m = getPath(raw, `${base}/${FIELD_PATHS.soilMoisture}`);
    const t = getPath(raw, `${base}/${FIELD_PATHS.temperature}`);
    if (!m.found) throw new SanitizeError(`Campo obrigatório ausente: ${base}/${FIELD_PATHS.soilMoisture}`);
    if (!t.found) throw new SanitizeError(`Campo obrigatório ausente: ${base}/${FIELD_PATHS.temperature}`);
    plants.push({
      id: plantId(n),
      soilMoisture: requireFiniteNumber(m.value, `${base}/${FIELD_PATHS.soilMoisture}`),
      temperatureC: requireFiniteNumber(t.value, `${base}/${FIELD_PATHS.temperature}`),
    });
  }
  plants.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const firmwareVersion = requireNonEmptyString(pickOne(raw, FIELD_PATHS.firmwareVersion, "Version"), "Version");
  const ts = pickOne(raw, FIELD_PATHS.reportedTimestamp, "Status/timestamp");
  // Preservado como string bruta: a unidade ainda precisa ser confirmada no firmware.
  const reportedTimestampRaw = requireNonEmptyString(ts, "Status/timestamp");
  if (!/^\d+$/.test(reportedTimestampRaw)) throw new SanitizeError("Status/timestamp precisa conter apenas dígitos");
  const reportIntervalMin = requireFiniteNumber(pickOne(raw, FIELD_PATHS.reportInterval, "reportInterval_min"), "reportInterval_min");
  if (!Number.isInteger(reportIntervalMin) || reportIntervalMin <= 0) {
    throw new SanitizeError("reportInterval_min precisa ser inteiro positivo");
  }

  const snapshot: SnapshotV1 = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    devicePseudonym: devicePseudonym(ctx),
    firmwareVersion,
    reportedTimestampRaw,
    reportIntervalMin,
    soilMoistureUnit: "unspecified",
    plants,
  };
  validateSnapshot(snapshot);
  return snapshot;
}

const SNAPSHOT_KEYS = [
  "schemaVersion",
  "source",
  "devicePseudonym",
  "firmwareVersion",
  "reportedTimestampRaw",
  "reportIntervalMin",
  "soilMoistureUnit",
  "plants",
].sort();
const PLANT_KEYS = ["id", "soilMoisture", "temperatureC"].sort();

function sameKeys(obj: object, expected: string[]): boolean {
  const k = Object.keys(obj).sort();
  return k.length === expected.length && k.every((x, i) => x === expected[i]);
}

/** Valida um snapshot apresentado (ex.: no verificador). Lança SanitizeError se não for um SnapshotV1 válido. */
export function validateSnapshot(s: unknown): asserts s is SnapshotV1 {
  if (s === null || typeof s !== "object" || Array.isArray(s)) throw new SanitizeError("Snapshot precisa ser objeto");
  if (!sameKeys(s, SNAPSHOT_KEYS)) throw new SanitizeError("Snapshot com campos diferentes do schema pog.snapshot.v1");
  const o = s as Record<string, unknown>;
  if (o.schemaVersion !== SCHEMA_VERSION) throw new SanitizeError("schemaVersion inesperado");
  if (o.source !== SOURCE) throw new SanitizeError("source inesperado");
  if (typeof o.devicePseudonym !== "string" || !/^[0-9a-f]{64}$/.test(o.devicePseudonym)) {
    throw new SanitizeError("devicePseudonym inválido");
  }
  requireNonEmptyString(o.firmwareVersion, "firmwareVersion");
  if (typeof o.reportedTimestampRaw !== "string" || !/^\d+$/.test(o.reportedTimestampRaw)) {
    throw new SanitizeError("reportedTimestampRaw inválido");
  }
  if (typeof o.reportIntervalMin !== "number" || !Number.isInteger(o.reportIntervalMin) || o.reportIntervalMin <= 0) {
    throw new SanitizeError("reportIntervalMin inválido");
  }
  if (o.soilMoistureUnit !== "unspecified") throw new SanitizeError("soilMoistureUnit inesperado");
  if (!Array.isArray(o.plants) || o.plants.length !== PLANT_COUNT) throw new SanitizeError("plants precisa ter 6 entradas");
  o.plants.forEach((p: unknown, i: number) => {
    if (p === null || typeof p !== "object" || !sameKeys(p, PLANT_KEYS)) throw new SanitizeError(`plants[${i}] fora do schema`);
    const pr = p as Record<string, unknown>;
    if (pr.id !== plantId(i + 1)) throw new SanitizeError(`plants[${i}].id deveria ser ${plantId(i + 1)} (ordem fixa)`);
    requireFiniteNumber(pr.soilMoisture, `plants[${i}].soilMoisture`);
    requireFiniteNumber(pr.temperatureC, `plants[${i}].temperatureC`);
  });
}
