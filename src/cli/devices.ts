/**
 * Lista os dispositivos de um export completo (/thecloudpot/arduinos/<MAC>) e diz quais
 * passam na sanitização pog.snapshot.v1. Não usa rede e não publica nada.
 * Saída local do dono do sistema: mostra os IDs para que ele escolha um com --device.
 */
import { existsSync } from "node:fs";
import { devicesOf } from "../adapters/export-shape.js";
import { readExportFile } from "../adapters/file.js";
import { args, deviceContext, loadEnv } from "../config.js";
import { epochSecondsToIso } from "../create-proof.js";
import { sanitize } from "../sanitize.js";
import { DEFAULT_INPUT, fail } from "./common.js";

loadEnv();
const a = args();
const input = a.input ?? DEFAULT_INPUT;
try {
  if (!existsSync(input)) throw new Error(`Export não encontrado: ${input}`);
  const devices = devicesOf(await readExportFile(input));
  if (!devices) throw new Error("Este arquivo é o export de um único dispositivo (não tem /thecloudpot/arduinos).");
  const rows = Object.entries(devices).map(([id, raw]) => {
    try {
      const s = sanitize(raw, deviceContext(id));
      return {
        device: id,
        ok: "sim",
        soilMoisture: s.plants.map((p) => p.soilMoisture).join(", "),
        reportedAt: epochSecondsToIso(s.reportedTimestampRaw) ?? s.reportedTimestampRaw,
        motivo: "",
      };
    } catch (e) {
      return { device: id, ok: "NÃO", soilMoisture: "", reportedAt: "", motivo: (e as Error).message };
    }
  });
  console.table(rows);
  const okCount = rows.filter((r) => r.ok === "sim").length;
  console.log(`${okCount} de ${rows.length} dispositivos prontos para prova. Ex.: npm run publish-proof -- --input ${input} --device ${rows.find((r) => r.ok === "sim")?.device ?? "<MAC>"}`);
} catch (e) {
  fail(e);
}
