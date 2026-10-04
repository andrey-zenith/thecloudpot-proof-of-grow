/** Sanitiza o export, publica o commitment na Devnet (Memo) e grava o recibo. Idempotente. */
import { existsSync } from "node:fs";
import { args, confirmationLevel, loadEnv, makeChain, pseudonymKeyVersion } from "../config.js";
import { createProof } from "../create-proof.js";
import { FileProofStore } from "../store.js";
import { DEFAULT_INPUT, fail, snapshotFromExport, writeJson } from "./common.js";

loadEnv();
const a = args();
const input = a.input ?? DEFAULT_INPUT;
if (!existsSync(input)) fail(new Error(`Export não encontrado: ${input}`));

try {
  const chain = makeChain({ withSigner: true });
  const { snapshot, commitment } = await snapshotFromExport(input, a);
  const snapshotRef = `out/snapshots/${commitment}.json`;
  writeJson(snapshotRef, snapshot);
  writeJson("out/snapshot.sanitized.json", snapshot);
  console.log(`Commitment: ${commitment}\nCarteira:   ${chain.signerAddress}\nCluster:    ${chain.cluster}`);

  const { receipt, outcome } = await createProof(snapshot, {
    chain,
    store: new FileProofStore("data/proofs"),
    requiredConfirmation: confirmationLevel(),
    snapshotRef,
    pseudonymKeyVersion: pseudonymKeyVersion(),
    log: (m) => console.log(m),
  });
  writeJson("out/receipt.json", receipt);
  writeJson(`out/receipts/${receipt.proofId}.json`, receipt);
  console.log(`\nResultado: ${outcome} (estado do recibo: ${receipt.state})`);
  console.log(`Assinatura: ${receipt.signature}`);
  console.log(`Explorer:   ${receipt.explorerUrl}`);
  console.log(`Recibo:     out/receipt.json`);
  if (outcome === "pending") console.log("Ainda não atingiu o nível de confirmação. Rode `npm run publish-proof` de novo para reconciliar (não reenvia).");
  if (outcome === "failed") process.exit(2);
} catch (e) {
  fail(e);
}
