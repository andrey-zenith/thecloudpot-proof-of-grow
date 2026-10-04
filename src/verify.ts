/**
 * verify(snapshot, receipt, expectedSigner) -> VerifyResult
 *
 * Não confia no hash do recibo: recalcula JCS + SHA-256 do snapshot apresentado,
 * busca a transação na Devnet e extrai o hash do próprio Memo on-chain.
 */
import { canonicalize } from "./canonicalize.js";
import type { ConfirmationLevel, ProofChain } from "./chain.js";
import { MEMO_PROGRAM_ID_STR } from "./constants.js";
import { hash } from "./hash.js";
import { parseMemoPayload } from "./payload.js";
import { validateSnapshot } from "./sanitize.js";

export type VerifyStatus = "verified" | "hash_mismatch" | "invalid_snapshot" | "invalid_proof" | "pending_or_unavailable";

export interface VerifyResult {
  status: VerifyStatus;
  cluster: string;
  signature: string | null;
  recomputedHash: string | null;
  onchainHash: string | null;
  expectedSigner: string;
  slot: number | null;
  blockTime: number | null;
  confirmation: ConfirmationLevel;
  reason: string;
  warnings: string[];
}

export interface ReceiptLike {
  cluster: string;
  signature: string | null;
  hash?: string;
}

export async function verify(
  snapshot: unknown,
  receipt: ReceiptLike,
  expectedSigner: string,
  chain: ProofChain,
  confirmation: ConfirmationLevel = "finalized",
): Promise<VerifyResult> {
  const res: VerifyResult = {
    status: "invalid_proof",
    cluster: chain.cluster,
    signature: receipt.signature,
    recomputedHash: null,
    onchainHash: null,
    expectedSigner,
    slot: null,
    blockTime: null,
    confirmation,
    reason: "",
    warnings: [],
  };
  const done = (status: VerifyStatus, reason: string) => Object.assign(res, { status, reason });

  // 1) Snapshot apresentado precisa ser um pog.snapshot.v1 válido.
  try {
    validateSnapshot(snapshot);
    res.recomputedHash = hash(canonicalize(snapshot));
  } catch (e) {
    return done("invalid_snapshot", (e as Error).message);
  }

  // 2) Recibo minimamente coerente.
  if (!receipt.signature) return done("invalid_proof", "Recibo sem assinatura de transação");
  if (receipt.cluster !== chain.cluster) {
    return done("invalid_proof", `Recibo é do cluster ${receipt.cluster}, verificador está em ${chain.cluster}`);
  }
  if (!expectedSigner) return done("invalid_proof", "Carteira esperada não informada");

  // 3) Buscar a transação. Falha de RPC ou ausência != adulteração.
  let tx;
  try {
    tx = await chain.getTransaction(receipt.signature, confirmation);
  } catch (e) {
    return done("pending_or_unavailable", `RPC indisponível: ${(e as Error).message}`);
  }
  if (!tx) return done("pending_or_unavailable", `Transação não encontrada no nível ${confirmation} (pode estar pendente)`);
  res.slot = tx.slot;
  res.blockTime = tx.blockTime;

  // 4) Transação bem-sucedida, assinada pela carteira esperada, com Memo pog reconhecido.
  if (tx.err !== null) return done("invalid_proof", `Transação falhou on-chain: ${JSON.stringify(tx.err)}`);
  if (!tx.signers.includes(expectedSigner)) return done("invalid_proof", "Carteira esperada não assinou a transação");
  const memos = tx.instructions
    .filter((ix) => ix.programId === MEMO_PROGRAM_ID_STR && ix.accounts.includes(expectedSigner))
    .map((ix) => parseMemoPayload(ix.data))
    .filter((p) => p !== null);
  if (memos.length === 0) return done("invalid_proof", "Nenhum Memo pog reconhecido assinado pela carteira esperada");
  if (memos.length > 1) return done("invalid_proof", "Mais de um Memo pog na mesma transação");
  res.onchainHash = memos[0]!.hash;

  if (receipt.hash && receipt.hash !== res.onchainHash) {
    res.warnings.push("O hash gravado no recibo difere do hash on-chain; o recibo foi ignorado nesse ponto.");
  }

  // 5) Comparação final: hash recalculado x hash do Memo on-chain.
  if (res.recomputedHash !== res.onchainHash) {
    return done("hash_mismatch", "O snapshot apresentado não corresponde ao commitment ancorado");
  }
  return done("verified", "Snapshot corresponde ao commitment ancorado e assinado pela carteira esperada");
}
