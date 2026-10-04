/**
 * Formatos de export aceitos:
 *  - "single": export de UM dispositivo (raiz = conteúdo do dispositivo: RealTimeControl, Version, …).
 *    O ID do dispositivo vem de --device ou POG_DEVICE_ID.
 *  - "full": export do banco inteiro, com os dispositivos em /thecloudpot/arduinos/<MAC>/…
 *    O ID do dispositivo é a própria chave do nó (escolhida com --device ou POG_DEVICE_ID).
 *
 * A mesma raiz (/thecloudpot/arduinos/{mac}) é a que o futuro trigger do RTDB vai usar.
 */
import { normalizeDeviceId } from "../sanitize.js";

export const DEVICES_PATH = ["thecloudpot", "arduinos"] as const;

export interface DeviceExport {
  deviceId: string;
  raw: unknown;
  shape: "single" | "full";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Retorna o mapa MAC -> conteúdo se for um export completo; null se for export de um dispositivo. */
export function devicesOf(raw: unknown): Record<string, unknown> | null {
  let cur: unknown = raw;
  for (const k of DEVICES_PATH) {
    if (!isObject(cur) || !Object.hasOwn(cur, k)) return null;
    cur = cur[k];
  }
  if (!isObject(cur)) throw new Error(`/${DEVICES_PATH.join("/")} existe mas não é um objeto`);
  return cur;
}

function sameDevice(a: string, b: string): boolean {
  try {
    return normalizeDeviceId(a) === normalizeDeviceId(b);
  } catch {
    return false;
  }
}

export function selectDevice(raw: unknown, wanted: string | undefined): DeviceExport {
  const devices = devicesOf(raw);
  if (!devices) {
    if (!wanted) throw new Error("Export de um dispositivo: informe o ID com --device <MAC> ou POG_DEVICE_ID no .env");
    return { deviceId: wanted, raw, shape: "single" };
  }
  const keys = Object.keys(devices);
  if (!wanted) {
    throw new Error(`Export completo com ${keys.length} dispositivos: escolha um com --device <MAC> (veja \`npm run devices\`)`);
  }
  const hits = keys.filter((k) => sameDevice(k, wanted));
  if (hits.length === 0) throw new Error(`Dispositivo ${wanted} não está neste export (veja \`npm run devices\`)`);
  if (hits.length > 1) throw new Error(`Mais de um nó corresponde a ${wanted}: ${hits.join(", ")}`);
  return { deviceId: hits[0]!, raw: devices[hits[0]!], shape: "full" };
}
