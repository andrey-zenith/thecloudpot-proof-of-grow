/** Gera a carteira exclusiva da Devnet e um .env inicial (sem sobrescrever nada existente). */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Keypair } from "@solana/web3.js";
import { keypairPath, loadEnv, loadKeypair } from "../config.js";

if (!existsSync(".env")) {
  const tpl = readFileSync(".env.example", "utf8").replace(/^POG_PSEUDONYM_SECRET=.*$/m, `POG_PSEUDONYM_SECRET=${randomBytes(32).toString("hex")}`);
  writeFileSync(".env", tpl, "utf8");
  console.log("Criado .env com POG_PSEUDONYM_SECRET aleatório. Preencha POG_DEVICE_ID.");
} else {
  console.log(".env já existe; não foi alterado.");
}
loadEnv();

const path = keypairPath();
if (existsSync(path)) {
  console.log(`Carteira já existe em ${path}; não foi sobrescrita.`);
} else {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(Keypair.generate().secretKey)), { encoding: "utf8", mode: 0o600 });
  console.log(`Carteira Devnet criada em ${path}.`);
}
const address = loadKeypair(path).publicKey.toBase58();
console.log(`\nEndereço público da carteira: ${address}`);
console.log("Abasteça com SOL de teste: https://faucet.solana.com (cluster Devnet) ou `npm run balance -- --airdrop`.");
