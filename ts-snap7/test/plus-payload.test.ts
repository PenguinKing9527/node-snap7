import { describe, expect, it } from "vitest";

import { DataType, encodePvalueBlob, encodeUint32Vlq, encodeUint64Vlq } from "../src/core/index.js";
import {
  buildCreateSessionPayload,
  buildReadPayload,
  buildWritePayload,
  parseReadResponse,
  parseWriteResponse
} from "../src/s7/plus/index.js";

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("S7CommPlus payload helpers", () => {
  it("builds read/write payloads and create-session payload", () => {
    const read = buildReadPayload([[1, 0, 4]]);
    const write = buildWritePayload([[1, 0, Uint8Array.of(1, 2, 3)]]);
    const createSession = buildCreateSessionPayload();

    expect(read.length).toBeGreaterThan(0);
    expect(write.length).toBeGreaterThan(read.length);
    expect(createSession.length).toBeGreaterThan(0);
  });

  it("parses read response values and item errors", () => {
    const value1 = concat(encodeUint32Vlq(1), encodePvalueBlob(Uint8Array.of(0xaa, 0xbb)));
    const value2 = concat(encodeUint32Vlq(2), Uint8Array.of(0x00, DataType.USINT, 0x42));
    const valuesEnd = encodeUint32Vlq(0);
    const errors = concat(encodeUint32Vlq(3), encodeUint64Vlq(5n), encodeUint32Vlq(0));
    const response = concat(encodeUint64Vlq(0n), value1, value2, valuesEnd, errors);

    const parsed = parseReadResponse(response);
    expect(parsed.length).toBe(3);
    expect(Array.from(parsed[0]!)).toEqual([0xaa, 0xbb]);
    expect(Array.from(parsed[1]!)).toEqual([0x42]);
    expect(parsed[2]).toBeNull();
  });

  it("parses write response success/failure", () => {
    const success = concat(encodeUint64Vlq(0n), encodeUint32Vlq(0));
    expect(() => parseWriteResponse(success)).not.toThrow();

    const failed = concat(encodeUint64Vlq(0n), encodeUint32Vlq(1), encodeUint64Vlq(7n), encodeUint32Vlq(0));
    expect(() => parseWriteResponse(failed)).toThrow(/Write failed/i);
  });
});
