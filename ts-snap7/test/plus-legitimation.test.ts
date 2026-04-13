import { describe, expect, it } from "vitest";

import { buildLegacyResponse, buildLegitimationPayload, buildNewResponse, deriveLegitimationKey } from "../src/s7/plus/index.js";

describe("S7CommPlus legitimation helpers", () => {
  it("derives deterministic 32-byte key from OMS secret", () => {
    const oms = Uint8Array.from({ length: 32 }, (_, i) => i);
    const key1 = deriveLegitimationKey(oms);
    const key2 = deriveLegitimationKey(oms);
    expect(key1.length).toBe(32);
    expect(Array.from(key1)).toEqual(Array.from(key2));
  });

  it("builds legacy response using SHA-1 xor challenge", () => {
    const challenge = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
    const out = buildLegacyResponse("secret", challenge);
    expect(out.length).toBe(20);
    expect(Array.from(out).some((v) => v !== 0)).toBe(true);
  });

  it("builds new encrypted response with AES-256-CBC", () => {
    const challenge = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i);
    const oms = Uint8Array.from({ length: 32 }, (_, i) => 0x20 + i);
    const encrypted = buildNewResponse("secret", challenge, oms, "operator");
    expect(encrypted.length % 16).toBe(0);
    expect(encrypted.length).toBeGreaterThan(0);
  });

  it("builds legitimation payload struct", () => {
    const payload = buildLegitimationPayload("secret", "operator");
    expect(payload.length).toBeGreaterThan(10);
    expect(payload[1]).toBe(0x17);
  });
});

