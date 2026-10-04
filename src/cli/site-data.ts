/**
 * Gera site/proofs.json para a página pública (proof.thecloudpot.com).
 * Publica SOMENTE: snapshot sanitizado (leituras + pseudônimo), assinatura, carteira, hash e horários.
 * Nunca o MAC: o comando aborta se encontrar algo com formato de MAC na saída.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Receipt } from "../create-proof.js";
import { MEMO_PROGRAM_ID_STR } from "../constants.js";
import { validateSnapshot } from "../sanitize.js";
import { fail, writeJson } from "./common.js";
import { loadEnv } from "../config.js";

loadEnv();
try {
  const dir = "data/proofs";
  if (!existsSync(dir)) throw new Error("data/proofs não existe. Publique uma prova primeiro.");
  const receipts = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Receipt)
    .filter((r) => r.state === "anchored" && r.signature)
    .sort((a, b) => (a.anchoredAt ?? "").localeCompare(b.anchoredAt ?? ""));
  if (receipts.length === 0) throw new Error("Nenhuma prova ancorada em data/proofs.");

  // Rótulos estáveis por pseudônimo (Grower A, B, C… na ordem da primeira prova de cada dispositivo).
  const labels = new Map<string, string>();
  const proofs = receipts.map((r) => {
    if (!existsSync(r.snapshotRef)) throw new Error(`Snapshot ${r.snapshotRef} não encontrado para a prova ${r.signature}`);
    const snapshot = JSON.parse(readFileSync(r.snapshotRef, "utf8"));
    validateSnapshot(snapshot);
    if (!labels.has(snapshot.devicePseudonym)) labels.set(snapshot.devicePseudonym, `Grower ${String.fromCharCode(65 + labels.size)}`);
    return {
      label: labels.get(snapshot.devicePseudonym),
      signature: r.signature,
      expectedSigner: r.expectedSigner,
      anchoredAt: r.anchoredAt,
      slot: r.slot,
      snapshot,
    };
  });
  const out = {
    generatedAt: new Date().toISOString(),
    cluster: "devnet",
    rpc: process.env.POG_PUBLIC_RPC_URL?.trim() || "https://api.devnet.solana.com",
    memoProgram: MEMO_PROGRAM_ID_STR,
    proofs: proofs.reverse(), // mais recente primeiro
  };
  const text = JSON.stringify(out);
  if (/\b[0-9A-Fa-f]{2}([:_-])[0-9A-Fa-f]{2}(\1[0-9A-Fa-f]{2}){4}\b/.test(text)) {
    throw new Error("A saída contém algo com formato de MAC. Nada foi gravado.");
  }
  writeJson("site/proofs.json", out);
  console.log(`site/proofs.json gravado com ${proofs.length} provas:`);
  for (const p of out.proofs) console.log(`  ${p.label}  ${p.signature?.slice(0, 12)}…  ${p.snapshot.plants.map((x: { soilMoisture: number }) => x.soilMoisture).join(", ")}`);
} catch (e) {
  fail(e);
}
