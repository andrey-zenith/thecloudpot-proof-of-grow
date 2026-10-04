/** Adaptador 1 (MVP): lê o export de um arquivo local, sem alterá-lo. */
import { readFile } from "node:fs/promises";
import { parseStrictJson } from "../strict-json.js";

export async function readExportFile(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  return parseStrictJson(text);
}
