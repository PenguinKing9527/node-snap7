import { describe, expect, it } from "vitest";

import {
  getReturnCodeDescription,
  LegacyS7Protocol,
  S7Area,
  S7BlockSubfunction,
  S7Function,
  S7PduType,
  S7WordLen
} from "../src/s7/legacy/index.js";

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

const buildUserDataResponse = (params: Uint8Array, data: Uint8Array, sequence = 1): Uint8Array => {
  const out = new Uint8Array(10 + params.length + data.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, 0x32);
  view.setUint8(1, S7PduType.USERDATA);
  view.setUint16(2, 0x0000, false);
  view.setUint16(4, sequence, false);
  view.setUint16(6, params.length, false);
  view.setUint16(8, data.length, false);
  out.set(params, 10);
  out.set(data, 10 + params.length);
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

    const readMk = protocol.buildReadAreaRequest(S7Area.MK, 0, 10, 4, S7WordLen.BYTE);
    expect(readMk[10]).toBe(S7Function.READ_AREA);
    expect(readMk[20]).toBe(S7Area.MK);
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
    expect(() => protocol.extractReadBytes(parsed)).toThrow(/Invalid address/i);
  });

  it("rejects write payload that is not aligned to requested word length", () => {
    const protocol = new LegacyS7Protocol();
    expect(() => protocol.buildWriteAreaRequest(S7Area.TM, 0, 0, Uint8Array.of(1, 2, 3), S7WordLen.TIMER)).toThrow(
      /not aligned/i
    );
  });

  it("builds and parses USER_DATA block catalog payloads", () => {
    const protocol = new LegacyS7Protocol();

    const list = protocol.buildListBlocksRequest();
    expect(list[1]).toBe(S7PduType.USERDATA);
    expect(list[16]).toBe(S7BlockSubfunction.LIST_ALL);

    const listByType = protocol.buildListBlocksOfTypeRequest(0x41);
    expect(listByType[16]).toBe(S7BlockSubfunction.LIST_BY_TYPE);

    const info = protocol.buildGetBlockInfoRequest(0x41, 123);
    expect(info[16]).toBe(S7BlockSubfunction.BLOCK_INFO);

    const followup = protocol.buildUserDataFollowupRequest(0x03, S7BlockSubfunction.LIST_BY_TYPE, 0x77);
    expect(followup[17]).toBe(0x77);
  });

  it("parses USER_DATA list-blocks/list-by-type responses", () => {
    const protocol = new LegacyS7Protocol();
    const params = Uint8Array.of(0x00, 0x01, 0x12, 0x08, 0x12, 0x43, 0x02, 0x10, 0x00, 0x00, 0x00, 0x00);
    const payload = Uint8Array.of(
      0x30,
      0x41,
      0x00,
      0x03,
      0x30,
      0x38,
      0x00,
      0x02,
      0x00,
      0x64,
      0x00,
      0x00,
      0x00,
      0xc8,
      0x00,
      0x00
    );
    const dataSection = new Uint8Array(4 + payload.length);
    dataSection.set([0xff, 0x09, 0x00, payload.length], 0);
    dataSection.set(payload, 4);
    const response = protocol.parseResponse(buildUserDataResponse(params, dataSection, 7));

    const counts = protocol.parseListBlocksResponse(response);
    expect(counts.DBCount).toBe(3);
    expect(counts.OBCount).toBe(2);

    const numbers = protocol.parseListBlocksOfTypeResponse(response);
    expect(numbers).toEqual([12353, 12344, 100, 200]);
  });

  it("parses USER_DATA block info payload", () => {
    const protocol = new LegacyS7Protocol();
    const raw = new Uint8Array(78);
    raw[1] = 0x41;
    raw[9] = 0x07;
    raw[10] = 0x01;
    new DataView(raw.buffer).setUint16(12, 321, false);
    new DataView(raw.buffer).setUint32(14, 65432, false);
    new DataView(raw.buffer).setUint16(34, 11, false);
    new DataView(raw.buffer).setUint16(38, 12, false);
    new DataView(raw.buffer).setUint16(40, 13, false);
    raw.set(Uint8Array.from([0x32, 0x30, 0x32, 0x34, 0x30, 0x34]), 22);
    raw.set(Uint8Array.from([0x32, 0x30, 0x32, 0x34, 0x30, 0x35]), 28);
    raw.set(Uint8Array.from([0x41, 0x55, 0x54, 0x48, 0x4f, 0x52, 0x20, 0x20]), 42);
    raw.set(Uint8Array.from([0x46, 0x41, 0x4d, 0x49, 0x4c, 0x59, 0x20, 0x20]), 50);
    raw.set(Uint8Array.from([0x48, 0x45, 0x41, 0x44, 0x45, 0x52, 0x20, 0x20]), 58);
    raw[66] = 0x05;
    new DataView(raw.buffer).setUint16(68, 0xabcd, false);

    const parsed = protocol.parseGetBlockInfoResponse({ sequence: 1, parameterLength: 0, dataLength: raw.length, data: raw });
    expect(parsed.block_type).toBe(0x41);
    expect(parsed.block_number).toBe(321);
    expect(parsed.load_size).toBe(65432);
    expect(parsed.version).toBe(5);
    expect(parsed.checksum).toBe(0xabcd);
  });

  it("builds upload/download/delete transfer requests and parses start upload handle", () => {
    const protocol = new LegacyS7Protocol();

    const start = protocol.buildStartUploadRequest(0x41, 123);
    expect(start[10]).toBe(0x1d);

    const upload = protocol.buildUploadRequest(0x01020304);
    expect(upload[10]).toBe(0x1e);

    const endUpload = protocol.buildEndUploadRequest(0x01020304);
    expect(endUpload[10]).toBe(0x1f);

    const download = protocol.buildDownloadRequest(0x41, 123, Uint8Array.of(1, 2, 3));
    expect(download[10]).toBe(0x1a);

    const downloadBlock = protocol.buildDownloadBlockRequest(Uint8Array.of(1, 2, 3, 4));
    expect(downloadBlock[10]).toBe(0x1b);

    const downloadEnd = protocol.buildDownloadEndedRequest();
    expect(downloadEnd[10]).toBe(0x1c);

    const del = protocol.buildDeleteBlockRequest(0x41, 123);
    expect(del[10]).toBe(0x28);

    const startRes = protocol.parseStartUploadResponse({
      sequence: 1,
      parameterLength: 0,
      dataLength: 0,
      rawParameters: Uint8Array.of(0x1d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x06, 0x30, 0x30, 0x30, 0x31, 0x32, 0x38)
    });
    expect(startRes.uploadId).toBe(1);
    expect(startRes.blockLength).toBe(128);
  });

  it("builds PLC control/clock/SZL requests and parses clock/SZL payloads", () => {
    const protocol = new LegacyS7Protocol();

    const stop = protocol.buildPlcControlRequest("stop");
    expect(stop[10]).toBe(0x29);
    const hot = protocol.buildPlcControlRequest("hot_start");
    expect(hot[10]).toBe(0x28);
    const cold = protocol.buildPlcControlRequest("cold_start");
    expect(cold[10]).toBe(0x28);

    const readSzl = protocol.buildReadSzlRequest(0x001c, 0);
    expect(readSzl[1]).toBe(S7PduType.USERDATA);

    const getClock = protocol.buildGetClockRequest();
    expect(getClock[1]).toBe(S7PduType.USERDATA);

    const setClock = protocol.buildSetClockRequest(new Date(2026, 3, 13, 10, 20, 30));
    expect(setClock[1]).toBe(S7PduType.USERDATA);

    const clockRaw = Uint8Array.of(0x00, 0x26, 0x04, 0x13, 0x10, 0x20, 0x30, 0x01);
    const parsedClock = protocol.parseGetClockResponse({
      sequence: 1,
      parameterLength: 0,
      dataLength: 8,
      returnCode: 0xff,
      data: clockRaw
    });
    expect(parsedClock.getFullYear()).toBe(2026);
    expect(parsedClock.getMonth()).toBe(3);
    expect(parsedClock.getDate()).toBe(13);

    const parsedSzl = protocol.parseReadSzlResponse({
      sequence: 1,
      parameterLength: 0,
      dataLength: 8,
      returnCode: 0xff,
      data: Uint8Array.of(0x00, 0x1c, 0x00, 0x00, 1, 2, 3, 4)
    });
    expect(parsedSzl.szlId).toBe(0x001c);
    expect(Array.from(parsedSzl.data)).toEqual([1, 2, 3, 4]);
  });

  it("maps S7 return codes to readable descriptions", () => {
    expect(getReturnCodeDescription(0xff)).toBe("Success");
    expect(getReturnCodeDescription(0x05)).toBe("Invalid address");
    expect(getReturnCodeDescription(0x9999)).toBe("Unknown error");
  });
});
