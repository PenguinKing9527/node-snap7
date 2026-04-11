import { describe, expect, it } from "vitest";

import {
  decodeInt32Vlq,
  decodeInt64Vlq,
  decodeUint32Vlq,
  decodeUint64Vlq,
  encodeInt32Vlq,
  encodeInt64Vlq,
  encodeUint32Vlq,
  encodeUint64Vlq
} from "../src/core/index.js";

describe("VLQ uint32", () => {
  it("encodes known values", () => {
    expect(encodeUint32Vlq(0)).toEqual(Uint8Array.of(0x00));
    expect(encodeUint32Vlq(0x7f)).toEqual(Uint8Array.of(0x7f));
    expect(encodeUint32Vlq(0x80)).toEqual(Uint8Array.of(0x81, 0x00));
    expect(encodeUint32Vlq(0x3fff)).toEqual(Uint8Array.of(0xff, 0x7f));
    expect(encodeUint32Vlq(0x4000)).toEqual(Uint8Array.of(0x81, 0x80, 0x00));
  });

  it("roundtrips values", () => {
    const values = [0, 1, 127, 128, 255, 256, 0xffff, 0xffffff, 0xffffffff];
    for (const value of values) {
      const encoded = encodeUint32Vlq(value);
      const [decoded, consumed] = decodeUint32Vlq(encoded);
      expect(decoded).toBe(value);
      expect(consumed).toBe(encoded.length);
    }
  });

  it("handles offset decode and range errors", () => {
    const encoded = encodeUint32Vlq(12345);
    const data = Uint8Array.from([0xaa, 0xbb, ...encoded]);
    const [decoded, consumed] = decodeUint32Vlq(data, 2);
    expect(decoded).toBe(12345);
    expect(consumed).toBe(encoded.length);

    expect(() => encodeUint32Vlq(-1)).toThrow(/out of range/i);
    expect(() => encodeUint32Vlq(0x100000000)).toThrow(/out of range/i);
    expect(() => decodeUint32Vlq(Uint8Array.of(0x80))).toThrow(/Unexpected end/i);
  });
});

describe("VLQ int32", () => {
  it("roundtrips signed values", () => {
    const values = [0, 1, -1, 63, -64, 64, -65, 0x7fffffff, -0x80000000];
    for (const value of values) {
      const encoded = encodeInt32Vlq(value);
      const [decoded, consumed] = decodeInt32Vlq(encoded);
      expect(decoded).toBe(value);
      expect(consumed).toBe(encoded.length);
    }
  });

  it("rejects out of range", () => {
    expect(() => encodeInt32Vlq(-0x80000001)).toThrow(/out of range/i);
    expect(() => encodeInt32Vlq(0x80000000)).toThrow(/out of range/i);
  });
});

describe("VLQ uint64 and int64", () => {
  it("roundtrips uint64 including special threshold", () => {
    const values = [0n, 1n, 127n, 128n, 0xffffffffn, 0x00ffffffffffffffn, 0x0100000000000000n, 0xffffffffffffffffn];
    for (const value of values) {
      const encoded = encodeUint64Vlq(value);
      const [decoded, consumed] = decodeUint64Vlq(encoded);
      expect(decoded).toBe(value);
      expect(consumed).toBe(encoded.length);
      expect(encoded.length).toBeLessThanOrEqual(9);
    }
  });

  it("roundtrips int64 signed values", () => {
    const values = [0n, 1n, -1n, 63n, -64n, 127n, -128n, 0x7fffffffffffffffn, -0x8000000000000000n];
    for (const value of values) {
      const encoded = encodeInt64Vlq(value);
      const [decoded, consumed] = decodeInt64Vlq(encoded);
      expect(decoded).toBe(value);
      expect(consumed).toBe(encoded.length);
      expect(encoded.length).toBeLessThanOrEqual(9);
    }
  });

  it("rejects uint64/int64 range and truncated decode", () => {
    expect(() => encodeUint64Vlq(-1n)).toThrow(/out of range/i);
    expect(() => encodeUint64Vlq(0x10000000000000000n)).toThrow(/out of range/i);
    expect(() => encodeInt64Vlq(-0x8000000000000001n)).toThrow(/out of range/i);
    expect(() => encodeInt64Vlq(0x8000000000000000n)).toThrow(/out of range/i);
    expect(() => decodeUint64Vlq(Uint8Array.of(0x80))).toThrow(/Unexpected end/i);
  });
});
