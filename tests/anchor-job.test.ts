import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicProof, runAnchorJob } from "../src/anchor-job.js";
import { FirestoreProofStore, type FirestoreLike } from "../src/firestore-store.js";
import { parseStrictJson } from "../src/strict-json.js";
import { FakeChain } from "./fake-chain.js";

class FakeDb implements FirestoreLike {
  docs = new Map<string, Record<string, unknown>>();
  collection(name: string) {
    return {
      doc: (id: string) => {
        const key = `${name}/${id}`;
        return {
          key,
          get: async () => ({ exists: this.docs.has(key), data: () => structuredClone(this.docs.get(key)) }),
          set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
            this.docs.set(key, opts?.merge ? { ...(this.docs.get(key) ?? {}), ...structuredClone(data) } : structuredClone(data));
          },
        };
      },
    };
  }
  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return fn({ get: (ref: any) => ref.get(), set: (ref: any, d: any, o: any) => ref.set(d, o) });
  }
}

const one = parseStrictJson(readFileSync("fixtures/example-export.json", "utf8")) as any;
const devices = () => ({
  "AA:BB:CC:DD:EE:01": structuredClone(one),
  "AA:BB:CC:DD:EE:02": (() => { const d = structuredClone(one); d.RealTimeControl.Status.Weed1.Humidity = 60; return d; })(),
  EXAMPLE_MAC_ADDRESS_001: { RealTimeControl: { Status: { Weed1: { Humidity: 1, Temperature: 2 } } } },
});
const secret = Buffer.alloc(32, 9);
const deps = (db: FakeDb, chain: FakeChain) => ({
  devices: devices(), pseudonymSecret: secret, chain, store: new FirestoreProofStore(db),
  requiredConfirmation: "finalized" as const, pseudonymKeyVersion: "1", pollIntervalMs: 1, confirmTimeoutMs: 50,
});

describe("ciclo de ancoragem da Function", () => {
  it("ancora os Growers válidos, pula o incompleto e não expõe MAC", async () => {
    const db = new FakeDb(), chain = new FakeChain();
    const logs: string[] = [];
    const res = await runAnchorJob({ ...deps(db, chain), log: (m) => logs.push(m) });
    expect(res.map((r) => r.outcome)).toEqual(["anchored", "anchored", "skipped"]);
    expect(chain.sendCount).toBe(2);
    const all = JSON.stringify([...db.docs.values()]) + logs.join("\n");
    expect(all).not.toMatch(/AA:BB|EXAMPLE_MAC/);
    const pubs = [...db.docs.values()].map(publicProof).filter(Boolean) as any[];
    expect(pubs).toHaveLength(2);
    expect(Object.keys(pubs[0]).sort()).toEqual(["anchoredAt", "expectedSigner", "level", "signature", "slot", "snapshot", "state"]);
    expect(pubs.every((p) => p.state === "anchored" && p.level === "finalized")).toBe(true);
  });

  it("rodar de novo com os mesmos dados reaproveita as provas (sem novas transações)", async () => {
    const db = new FakeDb(), chain = new FakeChain();
    await runAnchorJob(deps(db, chain));
    const again = await runAnchorJob(deps(db, chain));
    expect(again.map((r) => r.outcome)).toEqual(["reused", "reused", "skipped"]);
    expect(chain.sendCount).toBe(2);
  });

  it("uma execução não envia a prova que outra está processando (lock)", async () => {
    const db = new FakeDb(), chain = new FakeChain();
    const first = new FirestoreProofStore(db, "run-1");
    // simula outra execução segurando o lock de todas as provas
    const orig = first.withLock.bind(first);
    let res: any;
    await orig("x", async () => {
      res = await runAnchorJob({ ...deps(db, chain), store: new FirestoreProofStore(db, "run-2") });
    });
    expect(res.map((r: any) => r.outcome)).toEqual(["anchored", "anchored", "skipped"]); // lock de "x" não bloqueia outras provas
    const blocker = new FirestoreProofStore(db, "run-3");
    const id = [...db.docs.keys()][0]!.split("/")[1]!;
    await blocker.withLock(id, async () => {
      await expect(new FirestoreProofStore(db, "run-4").withLock(id, async () => 1)).rejects.toThrow(/processamento/);
    });
  });
});
