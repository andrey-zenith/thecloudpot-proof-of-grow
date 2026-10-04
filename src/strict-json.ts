/**
 * Parser JSON estrito para a entrada do pipeline.
 *
 * `JSON.parse` aceita chaves duplicadas silenciosamente (a última vence), o que
 * permitiria que dois leitores enxergassem valores diferentes no mesmo arquivo.
 * Aqui fazemos uma varredura estrutural que rejeita chaves duplicadas e, depois,
 * delegamos a conversão de valores ao `JSON.parse` nativo.
 */

export class StrictJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrictJsonError";
  }
}

export function parseStrictJson(text: string): unknown {
  // Exports gerados no Windows podem vir com BOM UTF-8.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  assertNoDuplicateKeys(src);
  let value: unknown;
  try {
    value = JSON.parse(src);
  } catch (err) {
    throw new StrictJsonError(`JSON inválido: ${(err as Error).message}`);
  }
  assertWellFormedStrings(value, "$");
  return value;
}

function assertWellFormedStrings(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new StrictJsonError(`String com surrogate inválido em ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertWellFormedStrings(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (!k.isWellFormed()) throw new StrictJsonError(`Chave com surrogate inválido em ${path}`);
      assertWellFormedStrings(v, `${path}.${k}`);
    }
  }
}

/** Varredura estrutural mínima: só acompanha objetos/arrays/strings para achar chaves repetidas. */
function assertNoDuplicateKeys(src: string): void {
  let i = 0;
  const ws = () => {
    while (i < src.length && " \t\n\r".includes(src[i]!)) i++;
  };
  const readString = (): string => {
    // src[i] === '"'
    const start = i;
    i++;
    while (i < src.length) {
      const c = src[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        try {
          return JSON.parse(src.slice(start, i)) as string;
        } catch {
          throw new StrictJsonError(`String inválida na posição ${start}`);
        }
      }
      i++;
    }
    throw new StrictJsonError("String não terminada");
  };
  const value = (path: string): void => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      const seen = new Set<string>();
      ws();
      if (src[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (src[i] !== '"') throw new StrictJsonError(`Esperava chave em ${path} (posição ${i})`);
        const key = readString();
        if (seen.has(key)) throw new StrictJsonError(`Chave duplicada "${key}" em ${path}`);
        seen.add(key);
        ws();
        if (src[i] !== ":") throw new StrictJsonError(`Esperava ':' em ${path}.${key}`);
        i++;
        value(`${path}.${key}`);
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i] === "}") {
          i++;
          return;
        }
        throw new StrictJsonError(`Esperava ',' ou '}' em ${path} (posição ${i})`);
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (src[i] === "]") {
        i++;
        return;
      }
      let n = 0;
      for (;;) {
        value(`${path}[${n++}]`);
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i] === "]") {
          i++;
          return;
        }
        throw new StrictJsonError(`Esperava ',' ou ']' em ${path} (posição ${i})`);
      }
    }
    if (c === '"') {
      readString();
      return;
    }
    // número, true, false, null: avança até um delimitador; JSON.parse valida depois.
    const start = i;
    while (i < src.length && !",}] \t\n\r".includes(src[i]!)) i++;
    if (i === start) throw new StrictJsonError(`Valor ausente em ${path} (posição ${i})`);
  };
  value("$");
  ws();
  if (i !== src.length) throw new StrictJsonError(`Conteúdo extra após o JSON (posição ${i})`);
}
