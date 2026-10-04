/**
 * Canonicalização RFC 8785 (JCS) + bytes UTF-8.
 *
 * Usa o pacote `canonicalize` (implementação de referência do RFC 8785), com
 * versão fixada no package-lock. Antes de canonicalizar, validamos o que o JCS
 * exige: apenas tipos JSON, números finitos e strings Unicode bem formadas.
 * JCS ordena as propriedades de objetos; NÃO reordena arrays nem normaliza Unicode.
 */
import jcs from "canonicalize";

export const CANON_ID = "jcs-rfc8785" as const;

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

export function canonicalString(value: unknown): string {
  assertJsonValue(value, "$");
  const out = jcs(value);
  if (typeof out !== "string") throw new CanonicalizationError("Valor não serializável");
  return out;
}

export function canonicalize(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalString(value));
}

function assertJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalizationError(`Número não finito em ${path}`);
    return;
  }
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new CanonicalizationError(`String inválida em ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonValue(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new CanonicalizationError(`Objeto não-JSON em ${path}`);
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!k.isWellFormed()) throw new CanonicalizationError(`Chave inválida em ${path}`);
      if (v === undefined) throw new CanonicalizationError(`undefined em ${path}.${k}`);
      assertJsonValue(v, `${path}.${k}`);
    }
    return;
  }
  throw new CanonicalizationError(`Tipo não suportado (${typeof value}) em ${path}`);
}
