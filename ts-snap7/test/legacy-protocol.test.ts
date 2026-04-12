import { describe, expect, it } from "vitest";

import { LegacyS7Protocol, S7Function, S7PduType } from "../src/s7/legacy/index.js";

const buildResponse = (params: Uint8Array, data: Uint8Array, sequence = 1): Uint8Array => {
  const out = new Uint8Array(12 + params.length + data.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, 0x32);
  view.setUint8(1, S7PduType.ACK_DATA);
  view.setUint16(2, 0x0000, false);
  view.setUint16(4, sequence, false);
  view.setUint16(6, params.length, false);
  view.setUint16(8, data.length, false);
  view.setUint8(10, 0x00);
  view.setUint8(11, 0x00);
  out.set(params, 12);
  out.set(data, 12 + params.length);
  return out;
};

describe("LegacyS7Protocol", () => {
  it("builds setup/read/write request PDUs", () => {
    const protocol = new LegacyS7Protocol();

    const setup = protocol.buildSetupCommunicationRequest(1, 1, 480);
    expect(setup[0]).toBe(0x32);
    expect(setup[1]).toBe(S7PduType.REQUEST);
    expect(setup[10]).toBe(S7Function.SETUP_COMMUNICATION);

    const read = protocol.buildReadDbRequest(1, 0, 4);
    expect(read[10]).toBe(S7Function.READ_AREA);
    expect(read.length).toBe(24);

    const write = protocol.buildWriteDbRequest(1, 0, Uint8Array.of(1, 2, 3, 4));
    expect(write[10]).toBe(S7Function.WRITE_AREA);
    expect(write.length).toBeGreaterThan(read.length);
  });

  it("parses setup response and extracts negotiated PDU length", () => {
    const protocol = new LegacyS7Protocol();
    const params = new Uint8Array(8);
    const view = new DataView(params.buffer);
    view.setUint8(0, S7Function.SETUP_COMMUNICATION);
    view.setUint8(1, 0x00);
    view.setUint16(2, 1, false);
    view.setUint16(4, 1, false);
    view.setUint16(6, 960, false);
    const response = buildResponse(params, new Uint8Array(0), 1);

    const parsed = protocol.parseResponse(response);
    expect(parsed.parameters?.pduLength).toBe(960);
  });

  it("extracts read bytes and validates write return code", () => {
    const protocol = new LegacyS7Protocol();

    const readParams = Uint8Array.of(S7Function.READ_AREA, 0x01);
    const readData = Uint8Array.of(0xff, 0x04, 0x00, 0x20, 0xde, 0xad, 0xbe, 0xef);
    const readResponse = buildResponse(readParams, readData, 2);
    const parsedRead = protocol.parseResponse(readResponse);
    expect(Array.from(protocol.extractReadBytes(parsedRead))).toEqual([0xde, 0xad, 0xbe, 0xef]);

    const writeParams = Uint8Array.of(S7Function.WRITE_AREA, 0x01);
    const writeData = Uint8Array.of(0xff);
    const writeResponse = buildResponse(writeParams, writeData, 3);
    const parsedWrite = protocol.parseResponse(writeResponse);
    expect(() => protocol.checkWriteResponse(parsedWrite)).not.toThrow();
  });

  it("throws for invalid protocol and failed return code", () => {
    const protocol = new LegacyS7Protocol();
    const badPdu = Uint8Array.of(0x00, 0x03, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0);
    expect(() => protocol.parseResponse(badPdu)).toThrow(/Invalid S7 protocol ID/i);

    const params = Uint8Array.of(S7Function.READ_AREA, 0x01);
    const data = Uint8Array.of(0x05, 0x04, 0x00, 0x08, 0x00);
    const response = buildResponse(params, data, 4);
    const parsed = protocol.parseResponse(response);
    expect(() => protocol.extractReadBytes(parsed)).toThrow(/Read failed/i);
  });
});
