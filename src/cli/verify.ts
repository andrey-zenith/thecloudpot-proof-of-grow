/** Verifica um snapshot contra a transação da Devnet indicada no recibo. */
import { existsSync, readFileSync } from "node:fs";
import { args, confirmationLevel, keypairPath, loadEnv, loadKeypair, makeChain } from "../config.js";
import { parseStrictJson } from "../strict-json.js";
import { verify, type VerifyResult } from "../verify.js";
import { fail } from "./common.js";

/** Carteira esperada: --signer, POG_EXPECTED_SIGNER, ou a carteira local. Nunca só o recibo. */
export function expectedSignerFromEnv(cli: Record<string, string>): string {
  if (cli.signer) return cli.signer;
  if (process.env.POG_EXPECTED_SIGNER?.trim()) return process.env.POG_EXPECTED_SIGNER.trim();
  if (existsSync(keypairPath())) return loadKeypair().publicKey.toBase58();
  throw new Error("Informe a carteira esperada com --signer <endereço> ou POG_EXPECTED_SIGNER");
}

export function printResult(r: VerifyResult): void {
  console.log(`\nStatus:           ${r.status.toUpperCase()}`);
  console.log(`Motivo:           ${r.reason}`);
  console.log(`Cluster:          ${r.cluster} (confirmação: ${r.confirmation})`);
  console.log(`Assinatura:       ${r.signature}`);
  console.log(`Carteira esperada:${" " + r.expectedSigner}`);
  console.log(`Hash recalculado: ${r.recomputedHash}`);
  console.log(`Hash on-chain:    ${r.onchainHash}`);
  if (r.slot !== null) console.log(`Slot:             ${r.slot}`);
  for (const w of r.warnings) console.log(`Aviso: ${w}`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("cli/verify.ts");
if (isMain) {
  loadEnv();
  const a = args();
  try {
    const snapshot = parseStrictJson(readFileSync(a.snapshot ?? "out/snapshot.sanitized.json", "utf8"));
    const receipt = JSON.parse(readFileSync(a.receipt ?? "out/receipt.json", "utf8"));
    const chain = makeChain({ withSigner: false });
    const r = await verify(snapshot, receipt, expectedSignerFromEnv(a), chain, confirmationLevel());
    printResult(r);
    process.exit(r.status === "verified" ? 0 : 3);
  } catch (e) {
    fail(e);
  }
}
