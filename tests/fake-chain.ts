/** Blockchain em memória para testes offline (sem rede). */
import { randomBytes } from "node:crypto";
import type { ChainTx, ConfirmationLevel, ProofChain, SignatureState, SignedTx } from "../src/chain.js";
import { MEMO_PROGRAM_ID_STR } from "../src/constants.js";

export class FakeChain implements ProofChain {
  readonly cluster = "devnet" as const;
  readonly signerAddress = "FakeSigner1111111111111111111111111111111111";
  pending = new Map<string, Uint8Array>();
  landed = new Map<string, ChainTx>();
  sendCount = 0;
  blockHeight = 100;
  /** Simulações */
  rpcDown = false;
  dropSends = false;
  failOnChain = false;

  async prepareMemoTx(memo: Uint8Array): Promise<SignedTx> {
    const signature = randomBytes(32).toString("hex");
    this.pending.set(signature, memo);
    return { signature, serialized: memo, lastValidBlockHeight: this.blockHeight + 150 };
  }
  async send(tx: SignedTx): Promise<void> {
    this.sendCount++;
    if (this.dropSends) return; // "enviado", mas nunca chega
    const memo = this.pending.get(tx.signature)!;
    this.landed.set(tx.signature, {
      signature: tx.signature,
      slot: 1000 + this.sendCount,
      blockTime: 1790969100,
      err: this.failOnChain ? { InstructionError: [0, "Custom"] } : null,
      signers: [this.signerAddress],
      instructions: [{ programId: MEMO_PROGRAM_ID_STR, accounts: [this.signerAddress], data: memo }],
    });
  }
  async getSignatureState(signature: string): Promise<SignatureState> {
    if (this.rpcDown) throw new Error("RPC timeout");
    const tx = this.landed.get(signature);
    return tx ? { found: true, level: "finalized", err: tx.err } : { found: false };
  }
  async getBlockHeight() {
    return this.blockHeight;
  }
  async getTransaction(signature: string, _level: ConfirmationLevel): Promise<ChainTx | null> {
    if (this.rpcDown) throw new Error("RPC timeout");
    return this.landed.get(signature) ?? null;
  }
}
