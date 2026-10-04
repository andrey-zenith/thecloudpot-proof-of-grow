import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalize, canonicalString } from "../src/canonicalize.js";
import { createProof } from "../src/create-proof.js";
import { hash } from "../src/hash.js";
import { buildMemoPayload, memoBytes, parseMemoPayload } from "../src/payload.js";
import { devicePseudonym, normalizeDeviceId, sanitize, type SnapshotV1 } from "../src/sanitize.js";
import { MemoryProofStore } from "../src/store.js";
import { parseStrictJson } from "../src/strict-json.js";
import { verify } from "../src/verify.js";
import { FakeChain } from "./fake-chain.js";

const EXPORT_TEXT = readFileSync("fixtures/example-export.json", "utf8");
const ctx = { deviceId: "AA:BB:CC:DD:EE:FF", pseudonymSecret: Buffer.alloc(32, 7) };
const load = () => parseStrictJson(EXPORT_TEXT) as any;
const snap = (raw = load()) => sanitize(raw, ctx);
const commit = (s: SnapshotV1) => hash(canonicalize(s));

describe("sanitize", () => {
  it("preserva exatamente as leituras do export", () => {
    const s = snap();
    expect(s.plants.map((p) => p.soilMoisture)).toEqual([74, 75, 75, 88, 50, 74]);
    expect(s.plants.every((p) => p.temperatureC === 26.25)).toBe(true);
    expect(s.plants.map((p) => p.id)).toEqual(["plant-01", "plant-02", "plant-03", "plant-04", "plant-05", "plant-06"]);
    expect(s.firmwareVersion).toBe("1.0.2");
    expect(s.reportedTimestampRaw).toBe("1790969067");
    expect(s.reportIntervalMin).toBe(5);
    expect(s.soilMoistureUnit).toBe("unspecified");
  });

  it("não inclui campos operacionais nem o identificador bruto", () => {
    const text = canonicalString(snap());
    for (const forbidden of ["Commands", "Schedules", "pumpTimeout", "lastAuto", "aa:bb", "aabbccddeeff", "ON", "OFF"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("rejeita leitura ausente em vez de virar zero", () => {
    const raw = load();
    delete raw.RealTimeControl.Status.Weed3.Humidity;
    expect(() => sanitize(raw, ctx)).toThrow(/ausente/);
  });

  it("rejeita leitura não numérica", () => {
    const raw = load();
    raw.RealTimeControl.Status.Weed2.Humidity = "75";
    expect(() => sanitize(raw, ctx)).toThrow(/número/);
  });

  it("rejeita chaves duplicadas no JSON de entrada", () => {
    expect(() => parseStrictJson('{"a":{"Humidity":74,"Humidity":73}}')).toThrow(/duplicada/);
  });

  it("pseudônimo: HMAC estável, mesma regra para formatos diferentes do mesmo MAC", () => {
    expect(normalizeDeviceId(" AA-BB-CC-DD-EE-FF ")).toBe("aabbccddeeff");
    expect(normalizeDeviceId("AA_BB_CC_DD_EE_FF")).toBe("aabbccddeeff");
    const a = devicePseudonym(ctx);
    const b = devicePseudonym({ ...ctx, deviceId: "aabbccddeeff" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(devicePseudonym({ ...ctx, pseudonymSecret: Buffer.alloc(32, 8) })).not.toBe(a);
  });
});

describe("canonicalize + hash", () => {
  it("é determinístico em execuções repetidas", () => {
    const h = commit(snap());
    for (let i = 0; i < 5; i++) expect(commit(snap())).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mudar a ordem das propriedades não muda o hash", () => {
    const s = snap();
    const reordered = Object.fromEntries(Object.entries(s).reverse()) as unknown as SnapshotV1;
    reordered.plants = s.plants.map((p) => ({ temperatureC: p.temperatureC, soilMoisture: p.soilMoisture, id: p.id }));
    expect(commit(reordered)).toBe(commit(s));
  });

  it("vetores do RFC 8785 (números e ordenação)", () => {
    expect(canonicalString({ b: 1, a: [1e21, 1e-7, 0.000001, -0, 26.25] })).toBe('{"a":[1e+21,1e-7,0.000001,0,26.25],"b":1}');
    expect(canonicalString({ "€": 1, "\r": 2, "1": 3 })).toBe('{"\\r":2,"1":3,"€":1}');
  });

  it("alterar qualquer leitura de soil moisture muda o hash", () => {
    const base = commit(snap());
    for (let n = 1; n <= 6; n++) {
      const raw = load();
      raw.RealTimeControl.Status[`Weed${n}`].Humidity += 1;
      expect(commit(sanitize(raw, ctx))).not.toBe(base);
    }
  });

  it("alterar campo excluído (LightSchedules) NÃO muda o hash — fora da fronteira", () => {
    const raw = load();
    raw.LightSchedules.Light.enabled = false;
    raw.RealTimeControl.Status.Weed1.H2O = "ON";
    raw.RealTimeControl.Configs.pumpTimeout_seconds = "999";
    expect(commit(sanitize(raw, ctx))).toBe(commit(snap()));
  });
});

describe("payload do Memo", () => {
  it("contém só o commitment e metadados mínimos", () => {
    const s = snap();
    const p = buildMemoPayload(commit(s));
    const text = new TextDecoder().decode(memoBytes(p));
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["alg", "app", "canon", "hash", "schema", "v"]);
    expect(text).not.toContain(s.devicePseudonym);
    expect(parseMemoPayload(memoBytes(p))).toEqual(p);
    expect(parseMemoPayload(new TextEncoder().encode('{"hello":"world"}'))).toBeNull();
  });
});

describe("createProof + verify (blockchain simulada)", () => {
  const setup = async () => {
    const chain = new FakeChain();
    const store = new MemoryProofStore();
    const s = snap();
    const deps = { chain, store, requiredConfirmation: "finalized" as const, snapshotRef: "mem", pseudonymKeyVersion: "1", pollIntervalMs: 1, confirmTimeoutMs: 50 };
    const { receipt, outcome } = await createProof(s, deps);
    return { chain, store, s, deps, receipt, outcome };
  };

  it("teste positivo: ancora e verifica (verified)", async () => {
    const { chain, s, receipt, outcome } = await setup();
    expect(outcome).toBe("anchored");
    expect(receipt.state).toBe("anchored");
    expect(receipt.explorerUrl).toContain("cluster=devnet");
    expect(receipt.reportedAtIso).toBe("2026-10-02T19:24:27.000Z");
    const r = await verify(s, receipt, chain.signerAddress, chain);
    expect(r.status).toBe("verified");
    expect(r.onchainHash).toBe(commit(s));
  });

  it("teste de adulteração 74 -> 73 contra a assinatura original: hash_mismatch", async () => {
    const { chain, receipt } = await setup();
    const raw = load();
    expect(raw.RealTimeControl.Status.Weed1.Humidity).toBe(74);
    raw.RealTimeControl.Status.Weed1.Humidity = 73;
    const sentBefore = chain.sendCount;
    const r = await verify(sanitize(raw, ctx), receipt, chain.signerAddress, chain);
    expect(r.status).toBe("hash_mismatch");
    expect(chain.sendCount).toBe(sentBefore); // nada foi publicado
  });

  it("não confia no hash do recibo", async () => {
    const { chain, s, receipt } = await setup();
    const forged = { ...receipt, hash: "0".repeat(64) };
    const r = await verify(s, forged, chain.signerAddress, chain);
    expect(r.status).toBe("verified");
    expect(r.warnings.length).toBe(1);
  });

  it("carteira diferente da esperada: invalid_proof", async () => {
    const { chain, s, receipt } = await setup();
    expect((await verify(s, receipt, "OutraCarteira", chain)).status).toBe("invalid_proof");
  });

  it("falha de RPC: pending_or_unavailable (não é adulteração)", async () => {
    const { chain, s, receipt } = await setup();
    chain.rpcDown = true;
    expect((await verify(s, receipt, chain.signerAddress, chain)).status).toBe("pending_or_unavailable");
  });

  it("snapshot fora do schema: invalid_snapshot", async () => {
    const { chain, s, receipt } = await setup();
    const bad = { ...s, extra: 1 };
    expect((await verify(bad, receipt, chain.signerAddress, chain)).status).toBe("invalid_snapshot");
  });

  it("transação com erro on-chain não é marcada anchored", async () => {
    const chain = new FakeChain();
    chain.failOnChain = true;
    const { receipt, outcome } = await createProof(snap(), {
      chain, store: new MemoryProofStore(), requiredConfirmation: "finalized", snapshotRef: "mem", pseudonymKeyVersion: "1", pollIntervalMs: 1,
    });
    expect(outcome).toBe("failed");
    expect(receipt.state).not.toBe("anchored");
  });

  it("reexecutar o mesmo job reutiliza a prova (sem novo envio)", async () => {
    const { chain, s, deps, receipt } = await setup();
    const again = await createProof(s, deps);
    expect(again.outcome).toBe("reused");
    expect(again.receipt.signature).toBe(receipt.signature);
    expect(chain.sendCount).toBe(1);
  });

  it("timeout: reconcilia pela assinatura e só reenvia após o blockhash expirar", async () => {
    const chain = new FakeChain();
    chain.dropSends = true;
    const store = new MemoryProofStore();
    const deps = { chain, store, requiredConfirmation: "finalized" as const, snapshotRef: "mem", pseudonymKeyVersion: "1", pollIntervalMs: 1, confirmTimeoutMs: 10 };
    const first = await createProof(snap(), deps);
    expect(first.outcome).toBe("pending");

    // Blockhash ainda válido: não reenvia.
    const second = await createProof(snap(), deps);
    expect(second.outcome).toBe("pending");
    expect(chain.sendCount).toBe(1);

    // Blockhash expirou: marca a tentativa como expired e envia uma nova (rastreável).
    chain.blockHeight += 1000;
    chain.dropSends = false;
    const third = await createProof(snap(), deps);
    expect(third.outcome).toBe("anchored");
    expect(third.receipt.attempts.map((a) => a.state)).toEqual(["expired", "finalized"]);
  });
});
