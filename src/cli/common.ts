import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { selectDevice, type DeviceExport } from "../adapters/export-shape.js";
import { readExportFile } from "../adapters/file.js";
import { canonicalString } from "../canonicalize.js";
import { deviceContext, wantedDevice } from "../config.js";
import { hash } from "../hash.js";
import { sanitize, type SnapshotV1 } from "../sanitize.js";

export const DEFAULT_INPUT = "fixtures/source-export.json";

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/** Lê o export (de um dispositivo ou completo) e devolve o nó do dispositivo escolhido. */
export async function loadDevice(input: string, cli: Record<string, string>): Promise<DeviceExport> {
  const dev = selectDevice(await readExportFile(input), wantedDevice(cli));
  if (dev.shape === "full") console.log(`Export completo: usando o dispositivo ${dev.deviceId}`);
  return dev;
}

export function snapshotOf(dev: DeviceExport): { snapshot: SnapshotV1; canonical: string; commitment: string } {
  const snapshot = sanitize(dev.raw, deviceContext(dev.deviceId));
  const canonical = canonicalString(snapshot);
  return { snapshot, canonical, commitment: hash(new TextEncoder().encode(canonical)) };
}

export async function snapshotFromExport(input: string, cli: Record<string, string>) {
  return snapshotOf(await loadDevice(input, cli));
}

export function fail(e: unknown): never {
  console.error(`\nERRO: ${(e as Error).message}`);
  process.exit(1);
}
