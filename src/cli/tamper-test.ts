/**
 * Teste de adulteração do guia: clona o export, muda SOMENTE
 * RealTimeControl/Status/Weed1/Humidity (valor - 1), re-sanitiza e verifica
 * contra a assinatura ORIGINAL. Esperado: hash_mismatch. Nada é publicado.
 * Também roda a verificação positiva com o snapshot original (esperado: verified).
 */
import { existsSync, readFileSync } from "node:fs";
import { args, confirmationLevel, deviceContext, loadEnv, makeChain } from "../config.js";
import { sanitize } from "../sanitize.js";
import { verify } from "../verify.js";
import { DEFAULT_INPUT, fail, loadDevice, writeJson } from "./common.js";
import { expectedSignerFromEnv, printResult } from "./verify.js";

loadEnv();
const a = args();
const input = a.input ?? DEFAULT_INPUT;
try {
  if (!existsSync("out/receipt.json")) throw new Error("out/receipt.json não existe. Rode `npm run publish-proof` primeiro.");
  const receipt = JSON.parse(readFileSync("out/receipt.json", "utf8"));
  const chain = makeChain({ withSigner: false });
  const signer = expectedSignerFromEnv(a);
  const level = confirmationLevel();

  const dev = await loadDevice(input, a);
  const ctx = deviceContext(dev.deviceId);
  const raw = dev.raw as any;
  const original = sanitize(raw, ctx);

  const tampered = structuredClone(raw);
  const before = tampered.RealTimeControl.Status.Weed1.Humidity;
  tampered.RealTimeControl.Status.Weed1.Humidity = before - 1;
  const tamperedSnapshot = sanitize(tampered, ctx);
  writeJson("out/snapshot.tampered.json", tamperedSnapshot);

  console.log("=== 1) Teste positivo: snapshot original x assinatura original ===");
  const pos = await verify(original, receipt, signer, chain, level);
  printResult(pos);

  console.log(`\n=== 2) Teste de adulteração: Weed1/Humidity ${before} -> ${before - 1} x assinatura original ===`);
  const neg = await verify(tamperedSnapshot, receipt, signer, chain, level);
  printResult(neg);

  const ok = pos.status === "verified" && neg.status === "hash_mismatch";
  console.log(`\nResultado: ${ok ? "PASSOU (verified + hash_mismatch)" : "NÃO PASSOU"}`);
  process.exit(ok ? 0 : 4);
} catch (e) {
  fail(e);
}
