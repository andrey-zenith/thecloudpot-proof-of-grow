/**
 * Implementação Solana (Devnet) via Memo Program v2.
 * A carteira do backend assina e também é incluída como signatária da instrução de Memo.
 */
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { ChainTx, Cluster, ConfirmationLevel, ProofChain, SignatureState, SignedTx } from "./chain.js";

import { MEMO_PROGRAM_ID_STR } from "./constants.js";
export const MEMO_PROGRAM_ID = new PublicKey(MEMO_PROGRAM_ID_STR);

export class SolanaProofChain implements ProofChain {
  readonly cluster: Cluster;
  readonly signerAddress: string;
  private readonly connection: Connection;
  private readonly signer: Keypair | null;

  constructor(opts: { rpcUrl: string; cluster: Cluster; signer?: Keypair }) {
    if (opts.cluster !== "devnet") throw new Error("O MVP só suporta devnet");
    this.cluster = opts.cluster;
    this.connection = new Connection(opts.rpcUrl, { commitment: "confirmed" });
    this.signer = opts.signer ?? null;
    this.signerAddress = this.signer?.publicKey.toBase58() ?? "";
  }

  get conn(): Connection {
    return this.connection;
  }

  async prepareMemoTx(memo: Uint8Array): Promise<SignedTx> {
    if (!this.signer) throw new Error("Carteira não carregada (somente leitura)");
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const ix = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: this.signer.publicKey, isSigner: true, isWritable: false }],
      data: Buffer.from(memo),
    });
    const msg = new TransactionMessage({
      payerKey: this.signer.publicKey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([this.signer]);
    const sig = tx.signatures[0];
    if (!sig) throw new Error("Falha ao assinar");
    const bs58 = (await import("bs58")).default;
    return { signature: bs58.encode(sig), serialized: tx.serialize(), lastValidBlockHeight };
  }

  async send(tx: SignedTx): Promise<void> {
    await this.connection.sendRawTransaction(tx.serialized, { skipPreflight: false, maxRetries: 3 });
  }

  async getSignatureState(signature: string): Promise<SignatureState> {
    const { value } = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const st = value[0];
    if (!st) return { found: false };
    const level = st.confirmationStatus ?? "processed";
    return { found: true, level, err: st.err };
  }

  async getBlockHeight(): Promise<number> {
    return this.connection.getBlockHeight("confirmed");
  }

  async getTransaction(signature: string, level: ConfirmationLevel): Promise<ChainTx | null> {
    const res = await this.connection.getTransaction(signature, { commitment: level, maxSupportedTransactionVersion: 0 });
    if (!res) return null;
    const message = res.transaction.message;
    const keys = message.getAccountKeys({ accountKeysFromLookups: res.meta?.loadedAddresses ?? null });
    const all: string[] = [];
    for (let i = 0; i < keys.length; i++) all.push(keys.get(i)!.toBase58());
    const signers = all.slice(0, message.header.numRequiredSignatures);
    return {
      signature,
      slot: res.slot,
      blockTime: res.blockTime ?? null,
      err: res.meta ? res.meta.err : "meta ausente",
      signers,
      instructions: message.compiledInstructions.map((ci) => ({
        programId: all[ci.programIdIndex] ?? "",
        accounts: ci.accountKeyIndexes.map((k) => all[k] ?? ""),
        data: ci.data,
      })),
    };
  }
}
