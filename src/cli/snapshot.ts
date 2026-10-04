/** Etapa offline: export -> snapshot sanitizado -> JCS -> SHA-256. Não usa rede. */
import { existsSync } from "node:fs";
import { args, loadEnv } from "../config.js";
import { epochSecondsToIso } from "../create-proof.js";
import { buildMemoPayload, deriveProofId } from "../payload.js";
import { EXCLUDED_FIELDS_DOC } from "../sanitize.js";
import { DEFAULT_INPUT, fail, snapshotFromExport, writeJson } from "./common.js";

loadEnv();
const a = args();
const input = a.input ?? DEFAULT_INPUT;
const out = a.out ?? "out/snapshot.sanitized.json";
if (!existsSync(input)) fail(new Error(`Export não encontrado: ${input}. Copie o export real para ${DEFAULT_INPUT} ou use --input fixtures/example-export.json`));

try {
  const { snapshot, canonical, commitment } = await snapshotFromExport(input, a);
  writeJson(out, snapshot);
  writeJson("out/commitment.json", {
    hash: commitment,
    canonical,
    memoPayload: buildMemoPayload(commitment),
    proofIdDevnet: deriveProofId("devnet", commitment),
    excludedFromCommitment: EXCLUDED_FIELDS_DOC,
  });
  console.log(`Snapshot sanitizado: ${out}`);
  console.table(snapshot.plants);
  console.log(`firmware ${snapshot.firmwareVersion} | intervalo ${snapshot.reportIntervalMin} min | timestamp ${snapshot.reportedTimestampRaw} (${epochSecondsToIso(snapshot.reportedTimestampRaw)})`);
  console.log(`\nSHA-256 (JCS): ${commitment}`);
} catch (e) {
  fail(e);
}
