/** Configuração local do MVP (.env). Na Function, os mesmos valores vêm do Secret Manager. */
import { existsSync, readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import type { ConfirmationLevel } from "./chain.js";
import type { PrivateDeviceContext } from "./sanitize.js";
import { SolanaProofChain } from "./solana.js";

export function loadEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Variável ${name} não definida. Rode \`npm run keygen\` e preencha o .env.`);
  return v;
}

export function pseudonymSecret(): Uint8Array {
  const secretHex = required("POG_PSEUDONYM_SECRET");
  if (!/^[0-9a-fA-F]{64,}$/.test(secretHex)) throw new Error("POG_PSEUDONYM_SECRET precisa ser hex com pelo menos 64 caracteres");
  return Buffer.from(secretHex, "hex");
}

/** Dispositivo pedido: --device tem prioridade sobre POG_DEVICE_ID. */
export function wantedDevice(cli: Record<string, string>): string | undefined {
  return cli.device?.trim() || process.env.POG_DEVICE_ID?.trim() || undefined;
}

export function deviceContext(deviceId: string): PrivateDeviceContext {
  return { deviceId, pseudonymSecret: pseudonymSecret() };
}

export function pseudonymKeyVersion(): string {
  return process.env.POG_PSEUDONYM_KEY_VERSION?.trim() || "1";
}

export function confirmationLevel(): ConfirmationLevel {
  const v = (process.env.POG_COMMITMENT ?? "finalized").trim();
  if (v !== "confirmed" && v !== "finalized") throw new Error("POG_COMMITMENT deve ser confirmed ou finalized");
  return v;
}

export function keypairPath(): string {
  return process.env.SOLANA_KEYPAIR_PATH?.trim() || "secrets/devnet-wallet.json";
}

export function loadKeypair(path = keypairPath()): Keypair {
  if (!existsSync(path)) throw new Error(`Carteira não encontrada em ${path}. Rode \`npm run keygen\`.`);
  const bytes = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export function makeChain(opts: { withSigner: boolean }): SolanaProofChain {
  const cluster = (process.env.SOLANA_CLUSTER ?? "devnet").trim();
  if (cluster !== "devnet") throw new Error("O MVP só aceita SOLANA_CLUSTER=devnet");
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com";
  return new SolanaProofChain({ rpcUrl, cluster, signer: opts.withSigner ? loadKeypair() : undefined });
}

/** Lê argumentos no formato --nome valor. */
export function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i]!;
    if (!k.startsWith("--")) continue;
    const next = a[i + 1];
    if (next === undefined || next.startsWith("--")) out[k.slice(2)] = "true";
    else {
      out[k.slice(2)] = next;
      i++;
    }
  }
  return out;
}
