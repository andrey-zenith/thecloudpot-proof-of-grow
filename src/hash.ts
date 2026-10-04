import { createHash } from "node:crypto";

export const HASH_ALG = "sha256" as const;

/** SHA-256 dos bytes canônicos, em hex minúsculo (64 caracteres). */
export function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isHex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
