/**
 * Payload mínimo publicado no Memo e identificador off-chain da prova.
 * O Memo NÃO contém snapshot, MAC, pseudônimo, chaves ou URLs privadas.
 */
import { canonicalString } from "./canonicalize.js";
import { CANON_ID } from "./canonicalize.js";
import { HASH_ALG, hash, isHex64 } from "./hash.js";
import { SCHEMA_VERSION } from "./sanitize.js";

export const APP_ID = "thecloudpot-pog" as const;
export const PAYLOAD_VERSION = 1 as const;
export const PROOF_DOMAIN = "pog.proof.v1" as const;

export interface MemoPayloadV1 {
  app: typeof APP_ID;
  v: typeof PAYLOAD_VERSION;
  schema: typeof SCHEMA_VERSION;
  alg: typeof HASH_ALG;
  canon: typeof CANON_ID;
  hash: string;
}

export function buildMemoPayload(commitment: string): MemoPayloadV1 {
  if (!isHex64(commitment)) throw new Error("commitment precisa ser hex de 64 caracteres");
  return { app: APP_ID, v: PAYLOAD_VERSION, schema: SCHEMA_VERSION, alg: HASH_ALG, canon: CANON_ID, hash: commitment };
}

/** Bytes UTF-8 do Memo (JSON canônico, para que o conteúdo on-chain seja determinístico). */
export function memoBytes(payload: MemoPayloadV1): Uint8Array {
  return new TextEncoder().encode(canonicalString(payload));
}

/** Interpreta um Memo on-chain. Retorna null se não for um payload pog v1 reconhecido. */
export function parseMemoPayload(data: Uint8Array): MemoPayloadV1 | null {
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "alg,app,canon,hash,schema,v") return null;
  if (o.app !== APP_ID || o.v !== PAYLOAD_VERSION || o.schema !== SCHEMA_VERSION || o.alg !== HASH_ALG || o.canon !== CANON_ID) {
    return null;
  }
  if (!isHex64(o.hash)) return null;
  return o as unknown as MemoPayloadV1;
}

/** proofId = SHA-256(domínio | cluster | schema | commitment). Mesmo snapshot no mesmo cluster -> mesma prova. */
export function deriveProofId(cluster: string, commitment: string): string {
  return hash(new TextEncoder().encode(`${PROOF_DOMAIN}|${cluster}|${SCHEMA_VERSION}|${commitment}`));
}
