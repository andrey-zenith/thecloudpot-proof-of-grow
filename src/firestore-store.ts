/**
 * ProofStore no Firestore (coleção dedicada; nunca Commands/Status).
 * Lock = "lease" gravado em transação no próprio documento da prova, com validade,
 * para que duas execuções da Function não enviem a mesma prova ao mesmo tempo.
 * Recebe a instância do Firestore por injeção (firebase-admin na Function, fake nos testes).
 */
import type { Receipt } from "./create-proof.js";
import { ProofLockedError, type ProofStore } from "./store.js";

export interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>;
}
export interface FirestoreLike {
  collection(name: string): { doc(id: string): DocRef };
  runTransaction<T>(fn: (tx: {
    get(ref: DocRef): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
    set(ref: DocRef, data: Record<string, unknown>, opts?: { merge?: boolean }): unknown;
  }) => Promise<T>): Promise<T>;
}

export const PROOFS_COLLECTION = "pogProofs";
const RECEIPT_FIELD = "receipt";

export class FirestoreProofStore implements ProofStore {
  constructor(
    private readonly db: FirestoreLike,
    private readonly holder = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    private readonly leaseMs = 4 * 60_000,
  ) {}

  private ref(id: string) {
    return this.db.collection(PROOFS_COLLECTION).doc(id);
  }

  async get(proofId: string): Promise<Receipt | null> {
    const snap = await this.ref(proofId).get();
    const r = snap.exists ? snap.data()?.[RECEIPT_FIELD] : undefined;
    return (r as Receipt | undefined) ?? null;
  }

  /** Grava o recibo + campos de consulta, preservando outros campos do doc (ex.: snapshot público). */
  async put(receipt: Receipt): Promise<void> {
    const last = receipt.attempts.at(-1);
    await this.ref(receipt.proofId).set(
      {
        [RECEIPT_FIELD]: receipt,
        state: receipt.state,
        level: last?.state ?? null,
        signature: receipt.signature,
        updatedAt: receipt.updatedAt,
      },
      { merge: true },
    );
  }

  /** Grava o snapshot sanitizado (dado público) junto da prova. */
  async putSnapshot(proofId: string, snapshot: unknown, reportedAt: number): Promise<void> {
    await this.ref(proofId).set({ snapshot, reportedAt }, { merge: true });
  }

  async withLock<T>(proofId: string, fn: () => Promise<T>): Promise<T> {
    const ref = this.ref(proofId);
    const now = Date.now();
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const lock = snap.exists ? (snap.data()?.lock as { holder: string; until: number } | undefined) : undefined;
      if (lock && lock.until > now && lock.holder !== this.holder) throw new ProofLockedError(proofId, `${PROOFS_COLLECTION}/${proofId}`);
      tx.set(ref, { lock: { holder: this.holder, until: now + this.leaseMs } }, { merge: true });
    });
    try {
      return await fn();
    } finally {
      await ref.set({ lock: null }, { merge: true });
    }
  }
}
