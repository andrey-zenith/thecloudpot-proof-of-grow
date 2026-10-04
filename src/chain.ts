/**
 * Interface entre a lógica da prova e a blockchain. A implementação real está em
 * solana.ts; os testes usam uma implementação em memória, sem rede.
 */
export type Cluster = "devnet";
export type ConfirmationLevel = "confirmed" | "finalized";

export interface SignedTx {
  signature: string;
  serialized: Uint8Array;
  lastValidBlockHeight: number;
}

export interface ChainInstruction {
  programId: string;
  accounts: string[];
  data: Uint8Array;
}

/** Visão mínima e normalizada de uma transação buscada via getTransaction. */
export interface ChainTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  /** meta.err: null = sucesso. */
  err: unknown;
  /** Contas que efetivamente assinaram a transação. */
  signers: string[];
  instructions: ChainInstruction[];
}

export type SignatureState = { found: false } | { found: true; level: "processed" | ConfirmationLevel; err: unknown };

export interface ProofChain {
  readonly cluster: Cluster;
  readonly signerAddress: string;
  /** Monta e assina a transação de Memo, sem enviar (assim a assinatura pode ser persistida antes). */
  prepareMemoTx(memo: Uint8Array): Promise<SignedTx>;
  send(tx: SignedTx): Promise<void>;
  getSignatureState(signature: string): Promise<SignatureState>;
  getBlockHeight(): Promise<number>;
  /** null = transação não encontrada (ainda) no nível pedido. Lança em falha de RPC. */
  getTransaction(signature: string, level: ConfirmationLevel): Promise<ChainTx | null>;
}

export function explorerUrl(signature: string, cluster: Cluster): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}
