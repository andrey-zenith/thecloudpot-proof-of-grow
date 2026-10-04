/** Mostra o saldo da carteira na Devnet; com --airdrop, pede 1 SOL de teste. */
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { args, loadEnv, makeChain } from "../config.js";
import { fail } from "./common.js";

loadEnv();
try {
  const chain = makeChain({ withSigner: true });
  const owner = new PublicKey(chain.signerAddress);
  if (args().airdrop) {
    try {
      const sig = await chain.conn.requestAirdrop(owner, 1 * LAMPORTS_PER_SOL);
      console.log(`Airdrop pedido: ${sig}. Aguardando confirmação…`);
      const bh = await chain.conn.getLatestBlockhash();
      await chain.conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    } catch (e) {
      console.error(`Airdrop recusado (${(e as Error).message}). Use https://faucet.solana.com com o endereço abaixo.`);
    }
  }
  console.log(`Carteira: ${chain.signerAddress}`);
  const lamports = await chain.conn.getBalance(owner, "confirmed");
  console.log(`Saldo (devnet): ${lamports / LAMPORTS_PER_SOL} SOL`);
} catch (e) {
  fail(e);
}
