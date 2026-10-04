import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { devicesOf, selectDevice } from "../src/adapters/export-shape.js";
import { canonicalize } from "../src/canonicalize.js";
import { hash } from "../src/hash.js";
import { sanitize } from "../src/sanitize.js";
import { parseStrictJson } from "../src/strict-json.js";

const single = () => parseStrictJson(readFileSync("fixtures/example-export.json", "utf8")) as any;
const secret = Buffer.alloc(32, 7);
const incomplete = {
  RealTimeControl: {
    Configs: { reportInterval_min: "5" },
    Status: { Weed1: { Humidity: 58, Temperature: 28 }, Weed2: { Humidity: 56, Temperature: 28 }, Weed3: { Humidity: 54, Temperature: 28 }, timestamp: 1791061500 },
  },
};
const full = () => ({
  thecloudpot: { arduinos: { "AA:BB:CC:DD:EE:01": single(), EXAMPLE_DEVICE: incomplete }, config: { schedulerV2: true } },
});

describe("formato do export", () => {
  it("export de um dispositivo exige o ID por fora", () => {
    expect(devicesOf(single())).toBeNull();
    expect(() => selectDevice(single(), undefined)).toThrow(/--device/);
    expect(selectDevice(single(), "AA:BB:CC:DD:EE:01").shape).toBe("single");
  });

  it("export completo: escolhe o nó pelo MAC em qualquer formato e usa a chave como ID", () => {
    const dev = selectDevice(full(), "aa_bb_cc_dd_ee_01");
    expect(dev.shape).toBe("full");
    expect(dev.deviceId).toBe("AA:BB:CC:DD:EE:01");
    expect(() => selectDevice(full(), undefined)).toThrow(/2 dispositivos/);
    expect(() => selectDevice(full(), "11:22:33:44:55:66")).toThrow(/não está/);
  });

  it("o mesmo dispositivo gera o mesmo hash no export completo e no individual", () => {
    const a = selectDevice(full(), "AA:BB:CC:DD:EE:01");
    const b = selectDevice(single(), "AA-BB-CC-DD-EE-01");
    const ha = hash(canonicalize(sanitize(a.raw, { deviceId: a.deviceId, pseudonymSecret: secret })));
    const hb = hash(canonicalize(sanitize(b.raw, { deviceId: b.deviceId, pseudonymSecret: secret })));
    expect(ha).toBe(hb);
  });

  it("dispositivo incompleto (3 plantas, sem Version) é rejeitado, não completado", () => {
    const dev = selectDevice(full(), "EXAMPLE_DEVICE");
    expect(() => sanitize(dev.raw, { deviceId: dev.deviceId, pseudonymSecret: secret })).toThrow(/ausente/);
  });
});
