import { describe, expect, it } from "vitest";

import {
  DataType,
  Opcode,
  PROTOCOL_ID,
  decodeAidFromTypedValue,
  decodeFloat32,
  decodeFloat64,
  decodeHeader,
  decodeInt16,
  decodeInt32,
  decodeInt64,
  decodeResponseHeader,
  decodeUint16,
  decodeUint32,
  decodeUint64,
  decodeUint8,
  decodeWString,
  encodeFloat32,
  encodeFloat64,
  encodeHeader,
  encodeInt16,
  encodeInt32,
  encodeInt64,
  encodeRequestHeader,
  encodeTypedValue,
  encodeUint16,
  encodeUint32,
  encodeUint64,
  encodeUint8,
  encodeWString
} from "../src/core/index.js";

describe("S7CommPlus headers", () => {
  it("encodes and decodes frame header", () => {
    const header = encodeHeader(0x03, 0x0100);
    expect(header.length).toBe(4);
    expect(header[0]).toBe(PROTOCOL_ID);
    expect(header[1]).toBe(0x03);

    const [version, length, consumed] = decodeHeader(header);
    expect(version).toBe(0x03);
    expect(length).toBe(0x0100);
    expect(consumed).toBe(4);
  });

  it("supports offset decode and rejects invalid data", () => {
    const header = encodeHeader(0x01, 42);
    const data = Uint8Array.from([0, 0, ...header]);
    expect(decodeHeader(data, 2)).toEqual([0x01, 42, 4]);
    expect(() => decodeHeader(Uint8Array.of(0x72, 0x01))).toThrow(/Not enough data/i);
    expect(() => decodeHeader(Uint8Array.of(0x32, 0x01, 0x00, 0x2a))).toThrow(/Invalid protocol ID/i);
  });

  it("encodes request header and decodes response header shape", () => {
    const header = encodeRequestHeader(0x054c, 42, 0x12345678, 0x36);
    expect(header.length).toBe(14);
    expect(header[0]).toBe(Opcode.REQUEST);

    const decoded = decodeResponseHeader(header);
    expect(decoded.functionCode).toBe(0x054c);
    expect(decoded.sequenceNumber).toBe(42);
    expect(decoded.sessionId).toBe(0x12345678);
    expect(decoded.transportFlags).toBe(0x36);
    expect(decoded.bytesConsumed).toBe(14);
  });
});

describe("Fixed-width primitives", () => {
  it("roundtrips integer and float primitives", () => {
    expect(decodeUint8(encodeUint8(255))).toEqual([255, 1]);
    expect(decodeUint16(encodeUint16(0xbeef))).toEqual([0xbeef, 2]);
    expect(decodeUint32(encodeUint32(0xdeadbeef))).toEqual([0xdeadbeef, 4]);
    expect(decodeUint64(encodeUint64(0x1234567890abcdefn))).toEqual([0x1234567890abcdefn, 8]);
    expect(decodeInt16(encodeInt16(-1000))).toEqual([-1000, 2]);
    expect(decodeInt32(encodeInt32(-100000))).toEqual([-100000, 4]);
    expect(decodeInt64(encodeInt64(-1234567890123n))).toEqual([-1234567890123n, 8]);

    const [f32] = decodeFloat32(encodeFloat32(3.14));
    const [f64] = decodeFloat64(encodeFloat64(3.141592653589793));
    expect(Math.abs(f32 - 3.14)).toBeLessThan(1e-6);
    expect(f64).toBe(3.141592653589793);
  });
});

describe("WString and typed values", () => {
  it("encodes and decodes WString", () => {
    const encoded = encodeWString("test");
    const [decoded, consumed] = decodeWString(encoded, 0, encoded.length);
    expect(decoded).toBe("test");
    expect(consumed).toBe(encoded.length);
  });

  it("encodes selected typed values", () => {
    expect(encodeTypedValue(DataType.NULL, null)).toEqual(Uint8Array.of(DataType.NULL));
    expect(encodeTypedValue(DataType.BOOL, true)).toEqual(Uint8Array.of(DataType.BOOL, 0x01));
    expect(encodeTypedValue(DataType.BYTE, 0xab)).toEqual(Uint8Array.of(DataType.BYTE, 0xab));
    expect(encodeTypedValue(DataType.UINT, 0x1234)).toEqual(Uint8Array.of(DataType.UINT, 0x12, 0x34));

    const wstring = encodeTypedValue(DataType.WSTRING, "test");
    expect(wstring[0]).toBe(DataType.WSTRING);
    expect(Array.from(wstring.slice(-4))).toEqual(Array.from(new TextEncoder().encode("test")));

    const blob = encodeTypedValue(DataType.BLOB, Uint8Array.of(1, 2, 3, 4));
    expect(blob[0]).toBe(DataType.BLOB);
    expect(Array.from(blob.slice(-4))).toEqual([1, 2, 3, 4]);
  });

  it("supports AID vlq decode helper and rejects unsupported type", () => {
    const aidTyped = encodeTypedValue(DataType.AID, 306);
    const [aid, consumed] = decodeAidFromTypedValue(aidTyped);
    expect(aid).toBe(306);
    expect(consumed).toBe(aidTyped.length);

    expect(() => encodeTypedValue(0xff as DataType, null)).toThrow(/Unsupported DataType/i);
    expect(() => decodeAidFromTypedValue(Uint8Array.of(DataType.BOOL, 1))).toThrow(/not AID/i);
  });
});
