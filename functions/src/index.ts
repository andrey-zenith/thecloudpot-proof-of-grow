/**
 * TheCloudPot Proof of Grow — Cloud Functions (codebase "proof-of-grow", separado das Functions existentes).
 *
 *  pogAnchor  — a cada 15 min: lê /thecloudpot/arduinos, ancora cada Grower válido na Solana DEVNET
 *               e grava o recibo em Firestore/pogProofs. Só LÊ o Realtime Database.
 *  pogProofs  — HTTPS, somente leitura: devolve as provas públicas (sem MAC) para a página.
 *
 * Segredos (Secret Manager): POG_WALLET_SECRET_KEY (conteúdo de secrets/devnet-wallet.json)
 *                            POG_PSEUDONYM_SECRET (o mesmo valor do .env, para manter os pseudônimos)
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { Keypair } from "@solana/web3.js";
import { SolanaProofChain } from "../../src/solana.js";
import { FirestoreProofStore, PROOFS_COLLECTION, type FirestoreLike } from "../../src/firestore-store.js";
import { publicProof, runAnchorJob } from "../../src/anchor-job.js";
import { DEVICES_PATH } from "../../src/adapters/export-shape.js";

const WALLET = defineSecret("POG_WALLET_SECRET_KEY");
const HMAC = defineSecret("POG_PSEUDONYM_SECRET");
const RPC_URL = process.env.POG_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const REGION = "us-central1";

initializeApp();

export const pogAnchor = onSchedule(
  {
    schedule: "every 15 minutes",
    region: REGION,
    secrets: [WALLET, HMAC],
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const secretHex = HMAC.value().trim();
    if (!/^[0-9a-fA-F]{64,}$/.test(secretHex)) throw new Error("POG_PSEUDONYM_SECRET inválido (hex de 64+ caracteres)");
    const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(WALLET.value()) as number[]));
    const chain = new SolanaProofChain({ rpcUrl: RPC_URL, cluster: "devnet", signer });

    const snap = await getDatabase().ref("/" + DEVICES_PATH.join("/")).get();
    const devices = (snap.val() ?? {}) as Record<string, unknown>;

    const results = await runAnchorJob({
      devices,
      pseudonymSecret: Buffer.from(secretHex, "hex"),
      chain,
      store: new FirestoreProofStore(getFirestore() as unknown as FirestoreLike),
      requiredConfirmation: "finalized",
      pseudonymKeyVersion: "1",
      confirmTimeoutMs: 60_000,
      log: (m) => logger.info(m),
    });
    logger.info("pogAnchor summary", { results });
  },
);

export const pogProofs = onRequest({ region: REGION, cors: true, maxInstances: 5, memory: "256MiB" }, async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("GET only");
    return;
  }
  const qs = await getFirestore().collection(PROOFS_COLLECTION).orderBy("reportedAt", "desc").limit(1000).get();
  const proofs = qs.docs.map((d) => publicProof(d.data())).filter((p) => p !== null);
  res.set("Cache-Control", "public, max-age=15, s-maxage=15");
  res.json({ generatedAt: new Date().toISOString(), cluster: "devnet", proofs });
});
