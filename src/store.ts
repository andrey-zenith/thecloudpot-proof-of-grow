/**
 * Registro off-chain das provas (recibos + tentativas) com lock por proofId.
 * MVP: arquivos locais em data/proofs/. Na Function, trocar por coleção dedicada no
 * Firestore (ex.: pogProofs) usando transação; NUNCA escrever em Commands/Status.
 */
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Receipt } from "./create-proof.js";

export interface ProofStore {
  get(proofId: string): Promise<Receipt | null>;
  put(receipt: Receipt): Promise<void>;
  /** Executa fn com exclusão mútua por proofId (evita envios concorrentes). */
  withLock<T>(proofId: string, fn: () => Promise<T>): Promise<T>;
}

export class ProofLockedError extends Error {
  constructor(proofId: string, lockPath: string) {
    super(`Prova ${proofId.slice(0, 12)}… já está em processamento (lock: ${lockPath}). Se nenhum processo estiver rodando, apague o arquivo .lock.`);
    this.name = "ProofLockedError";
  }
}

export class FileProofStore implements ProofStore {
  constructor(private readonly dir: string) {}

  private file(id: string) {
    return join(this.dir, `${id}.json`);
  }

  async get(proofId: string): Promise<Receipt | null> {
    try {
      return JSON.parse(await readFile(this.file(proofId), "utf8")) as Receipt;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async put(receipt: Receipt): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(receipt.proofId)}.tmp`;
    await writeFile(tmp, JSON.stringify(receipt, null, 2) + "\n", "utf8");
    await rename(tmp, this.file(receipt.proofId));
  }

  async withLock<T>(proofId: string, fn: () => Promise<T>): Promise<T> {
    await mkdir(this.dir, { recursive: true });
    const lockPath = join(this.dir, `${proofId}.lock`);
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ProofLockedError(proofId, lockPath);
      throw e;
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      await handle.close();
      return await fn();
    } finally {
      await rm(lockPath, { force: true });
    }
  }
}

export class MemoryProofStore implements ProofStore {
  readonly records = new Map<string, Receipt>();
  private readonly locks = new Set<string>();
  async get(id: string) {
    const r = this.records.get(id);
    return r ? structuredClone(r) : null;
  }
  async put(r: Receipt) {
    this.records.set(r.proofId, structuredClone(r));
  }
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.locks.has(id)) throw new ProofLockedError(id, "memory");
    this.locks.add(id);
    try {
      return await fn();
    } finally {
      this.locks.delete(id);
    }
  }
}
