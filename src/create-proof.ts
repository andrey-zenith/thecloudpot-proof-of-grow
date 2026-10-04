/**
 * createProof(snapshot, dependencies) -> Receipt
 *
 * Fluxo: valida snapshot -> JCS -> SHA-256 -> payload do Memo -> proofId -> lock ->
 * (reaproveita / reconcilia / envia) -> persiste tentativa ANTES de aguardar confirmação ->
 * marca "anchored" só após sucesso no nível de confirmação exigido.
 */
import { canonicalize, CANON_ID } from "./canonicalize.js";
import { type ConfirmationLevel, type ProofChain, explorerUrl } from "./chain.js";
import { HASH_ALG, hash } from "./hash.js";
import { buildMemoPayload, deriveProofId, memoBytes, type MemoPayloadV1 } from "./payload.js";
import { SANITIZER_VERSION, SCHEMA_VERSION, type SnapshotV1, validateSnapshot } from "./sanitize.js";
import { MEMO_PROGRAM_ID_STR } from "./constants.js";
import type { ProofStore } from "./store.js";

export type ReceiptState = "submitted" | "anchored" | "failed";

export interface Attempt {
  signature: string;
  lastValidBlockHeight: number;
  submittedAt: string;
  state: "submitted" | "confirmed" | "finalized" | "failed" | "expired";
  error?: string;
}

export interface Receipt {
  receiptVersion: "pog.receipt.v1";
  proofId: string;
  cluster: string;
  state: ReceiptState;
  /** Assinatura da tentativa ativa (a que ancorou, ou a mais recente). */
  signature: string | null;
  explorerUrl: string | null;
  hash: string;
  schema: typeof SCHEMA_VERSION;
  alg: typeof HASH_ALG;
  canon: typeof CANON_ID;
  sanitizerVersion: typeof SANITIZER_VERSION;
  memoProgramId: string;
  memoPayload: MemoPayloadV1;
  expectedSigner: string;
  requiredConfirmation: ConfirmationLevel;
  slot: number | null;
  blockTime: number | null;
  /** Referência privada ao snapshot sanitizado (caminho/ID interno). */
  snapshotRef: string;
  pseudonymKeyVersion: string;
  /** Somente informativo; o hash cobre reportedTimestampRaw como string. */
  reportedAtIso: string | null;
  attempts: Attempt[];
  createdAt: string;
  updatedAt: string;
  anchoredAt: string | null;
}

export interface CreateProofDeps {
  chain: ProofChain;
  store: ProofStore;
  requiredConfirmation: ConfirmationLevel;
  snapshotRef: string;
  pseudonymKeyVersion: string;
  /** Tempo máximo esperando confirmação nesta execução (ms). */
  confirmTimeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface CreateProofResult {
  receipt: Receipt;
  /** "reused" = prova já ancorada; "anchored" = ancorada agora; "pending" = enviada, aguardando. */
  outcome: "reused" | "anchored" | "pending" | "failed";
}

const LEVEL_RANK = { processed: 0, confirmed: 1, finalized: 2 } as const;

export function epochSecondsToIso(raw: string): string | null {
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function createProof(snapshot: SnapshotV1, deps: CreateProofDeps): Promise<CreateProofResult> {
  const { chain, store } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  validateSnapshot(snapshot);
  const commitment = hash(canonicalize(snapshot));
  const payload = buildMemoPayload(commitment);
  const memo = memoBytes(payload);
  const proofId = deriveProofId(chain.cluster, commitment);

  return store.withLock(proofId, async () => {
    let receipt = await store.get(proofId);
    if (receipt?.state === "anchored") {
      log(`Prova já ancorada (${receipt.signature}); reutilizando.`);
      return { receipt, outcome: "reused" as const };
    }
    if (!receipt) {
      const t = now().toISOString();
      receipt = {
        receiptVersion: "pog.receipt.v1",
        proofId,
        cluster: chain.cluster,
        state: "submitted",
        signature: null,
        explorerUrl: null,
        hash: commitment,
        schema: SCHEMA_VERSION,
        alg: HASH_ALG,
        canon: CANON_ID,
        sanitizerVersion: SANITIZER_VERSION,
        memoProgramId: MEMO_PROGRAM_ID_STR,
        memoPayload: payload,
        expectedSigner: chain.signerAddress,
        requiredConfirmation: deps.requiredConfirmation,
        slot: null,
        blockTime: null,
        snapshotRef: deps.snapshotRef,
        pseudonymKeyVersion: deps.pseudonymKeyVersion,
        reportedAtIso: epochSecondsToIso(snapshot.reportedTimestampRaw),
        attempts: [],
        createdAt: t,
        updatedAt: t,
        anchoredAt: null,
      };
    }
    const r = receipt;
    const save = async () => {
      r.updatedAt = now().toISOString();
      await store.put(r);
    };

    // 1) Reconciliar tentativas pendentes antes de pensar em reenviar.
    for (const a of r.attempts.filter((x) => x.state === "submitted" || x.state === "confirmed")) {
      const st = await chain.getSignatureState(a.signature);
      if (st.found) {
        if (st.err) {
          a.state = "failed";
          a.error = JSON.stringify(st.err);
        } else if (LEVEL_RANK[st.level] >= LEVEL_RANK.confirmed) {
          a.state = st.level === "finalized" ? "finalized" : "confirmed";
        }
        // Encontrada sem erro: não reenviar; aguardar abaixo.
      } else if ((await chain.getBlockHeight()) > a.lastValidBlockHeight) {
        a.state = "expired"; // blockhash venceu: a transação não pode mais entrar.
      }
    }
    await save();

    let active = r.attempts.find((a) => a.state === "submitted" || a.state === "confirmed" || a.state === "finalized");

    // 2) Sem tentativa viva: montar, assinar, PERSISTIR e só então enviar.
    if (!active) {
      const tx = await chain.prepareMemoTx(memo);
      active = { signature: tx.signature, lastValidBlockHeight: tx.lastValidBlockHeight, submittedAt: now().toISOString(), state: "submitted" };
      r.attempts.push(active);
      r.signature = tx.signature;
      r.explorerUrl = explorerUrl(tx.signature, chain.cluster);
      r.state = "submitted";
      await save();
      log(`Enviando transação ${tx.signature} …`);
      try {
        await chain.send(tx);
      } catch (e) {
        // Pode ter chegado mesmo assim; a próxima execução reconcilia pela assinatura.
        active.error = `send: ${(e as Error).message}`;
        await save();
        throw e;
      }
    } else {
      r.signature = active.signature;
      r.explorerUrl = explorerUrl(active.signature, chain.cluster);
    }

    // 3) Aguardar o nível de confirmação exigido.
    const deadline = Date.now() + (deps.confirmTimeoutMs ?? 90_000);
    const poll = deps.pollIntervalMs ?? 2_000;
    for (;;) {
      const st = await chain.getSignatureState(active.signature);
      if (st.found && st.err) {
        active.state = "failed";
        active.error = JSON.stringify(st.err);
        r.state = "failed";
        await save();
        return { receipt: r, outcome: "failed" as const };
      }
      if (st.found && LEVEL_RANK[st.level] >= LEVEL_RANK[deps.requiredConfirmation]) break;
      if (st.found && st.level !== "processed" && active.state !== st.level) {
        active.state = st.level; // visível na página: Sending… -> Confirmed -> Finalized
        await save();
      }
      if (Date.now() > deadline) {
        await save();
        log("Tempo esgotado aguardando confirmação; rode o comando de novo para reconciliar.");
        return { receipt: r, outcome: "pending" as const };
      }
      await sleep(poll);
    }

    // 4) Conferir a transação de fato (sucesso + slot) antes de marcar anchored.
    const tx = await chain.getTransaction(active.signature, deps.requiredConfirmation);
    if (!tx) {
      await save();
      return { receipt: r, outcome: "pending" as const };
    }
    if (tx.err !== null) {
      active.state = "failed";
      active.error = JSON.stringify(tx.err);
      r.state = "failed";
      await save();
      return { receipt: r, outcome: "failed" as const };
    }
    active.state = deps.requiredConfirmation;
    r.state = "anchored";
    r.slot = tx.slot;
    r.blockTime = tx.blockTime;
    r.anchoredAt = now().toISOString();
    await save();
    return { receipt: r, outcome: "anchored" as const };
  });
}
