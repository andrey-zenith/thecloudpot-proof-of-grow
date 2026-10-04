/**
 * Um ciclo de ancoragem: para cada Grower do RTDB, sanitiza, publica (ou reaproveita) e grava o recibo.
 * Função pura em relação à infraestrutura (tudo por injeção), para ser testada sem rede.
 */
import { canonicalize } from "./canonicalize.js";
import type { ConfirmationLevel, ProofChain } from "./chain.js";
import { createProof } from "./create-proof.js";
import { hash } from "./hash.js";
import { deriveProofId } from "./payload.js";
import { devicePseudonym, sanitize } from "./sanitize.js";
import { ProofLockedError } from "./store.js";
import type { FirestoreProofStore } from "./firestore-store.js";

export interface AnchorJobDeps {
  devices: Record<string, unknown>;
  pseudonymSecret: Uint8Array;
  chain: ProofChain;
  store: Pick<FirestoreProofStore, "get" | "put" | "withLock" | "putSnapshot">;
  requiredConfirmation: ConfirmationLevel;
  pseudonymKeyVersion: string;
  confirmTimeoutMs?: number;
  pollIntervalMs?: number;
  log?: (msg: string) => void;
}

export interface AnchorResult {
  grower: string; // pseudônimo abreviado: nunca o MAC
  outcome: "anchored" | "reused" | "pending" | "failed" | "skipped" | "locked" | "error";
  detail?: string;
  signature?: string | null;
}

export async function runAnchorJob(deps: AnchorJobDeps): Promise<AnchorResult[]> {
  const log = deps.log ?? (() => {});
  const results: AnchorResult[] = [];
  for (const [deviceId, raw] of Object.entries(deps.devices)) {
    const ctx = { deviceId, pseudonymSecret: deps.pseudonymSecret };
    let who = "unknown";
    try {
      who = devicePseudonym(ctx).slice(0, 8);
    } catch {
      /* ID fora da regra pog.device.v1 */
    }
    let snapshot;
    try {
      snapshot = sanitize(raw, ctx);
    } catch (e) {
      results.push({ grower: who, outcome: "skipped", detail: (e as Error).message });
      continue;
    }
    try {
      const commitment = hash(canonicalize(snapshot));
      const proofId = deriveProofId(deps.chain.cluster, commitment);
      await deps.store.putSnapshot(proofId, snapshot, Number(snapshot.reportedTimestampRaw));
      const { receipt, outcome } = await createProof(snapshot, {
        chain: deps.chain,
        store: deps.store,
        requiredConfirmation: deps.requiredConfirmation,
        snapshotRef: `pogProofs/${proofId}`,
        pseudonymKeyVersion: deps.pseudonymKeyVersion,
        confirmTimeoutMs: deps.confirmTimeoutMs,
        pollIntervalMs: deps.pollIntervalMs,
      });
      results.push({ grower: who, outcome, signature: receipt.signature });
    } catch (e) {
      results.push({ grower: who, outcome: e instanceof ProofLockedError ? "locked" : "error", detail: (e as Error).message });
    }
  }
  for (const r of results) log(`grower ${r.grower}: ${r.outcome}${r.signature ? " " + r.signature : ""}${r.detail ? " (" + r.detail + ")" : ""}`);
  return results;
}

/** Forma pública de uma prova (o que a página recebe). Nunca inclui MAC, lock ou tentativas internas. */
export function publicProof(doc: Record<string, unknown>): Record<string, unknown> | null {
  const receipt = doc.receipt as Record<string, unknown> | undefined;
  const snapshot = doc.snapshot as Record<string, unknown> | undefined;
  if (!receipt || !snapshot) return null;
  return {
    signature: receipt.signature ?? null,
    expectedSigner: receipt.expectedSigner,
    state: receipt.state,
    level: doc.level ?? null,
    anchoredAt: receipt.anchoredAt ?? null,
    slot: receipt.slot ?? null,
    snapshot,
  };
}
