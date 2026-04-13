import { describe, expect, it } from "vitest";

import { Snap7ConnectionError } from "../src/errors/index.js";
import { LegacyS7AsyncClient, S7Function, S7PduType } from "../src/s7/legacy/index.js";
import { Block } from "../src/types.js";
import type { LegacyTransport } from "../src/s7/legacy/index.js";
import type { TransportConnectOptions, TransportRequestOptions } from "../src/transport/types.js";

const wrapCotpDt = (pdu: Uint8Array): Uint8Array => {
  const out = new Uint8Array(3 + pdu.length);
  out.set([0x02, 0xf0, 0x80], 0);
  out.set(pdu, 3);
  return out;
};

const buildS7Response = (params: Uint8Array, data: Uint8Array, sequence = 1): Uint8Array => {
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

class FakeLegacyTransport implements LegacyTransport {
  public connected = false;
  public requests: Uint8Array[] = [];

  public connect(_options: TransportConnectOptions): Promise<void> {
    void _options;
    this.connected = true;
    return Promise.resolve();
  }

  public request(payload: Uint8Array, _options?: TransportRequestOptions): Promise<Uint8Array> {
    void _options;
    this.requests.push(payload);
    const s7Request = payload.slice(3);
    const pduType = s7Request[1];

    if (pduType === S7PduType.USERDATA) {
      const subfunction = s7Request[16];
      const typeGroup = s7Request[15] ?? 0x43;
      const group = typeGroup & 0x0f;
      const params = Uint8Array.of(0x00, 0x01, 0x12, 0x08, 0x12, 0x43, subfunction ?? 0, 0x10, 0x00, 0x00, 0x00, 0x00);

      if (group === 0x03 && subfunction === 0x01) {
        const payloadBytes = Uint8Array.of(0x30, 0x41, 0x00, 0x02, 0x30, 0x38, 0x00, 0x01);
        const data = new Uint8Array(4 + payloadBytes.length);
        data.set([0xff, 0x09, 0x00, payloadBytes.length], 0);
        data.set(payloadBytes, 4);
        return Promise.resolve(wrapCotpDt(buildUserDataResponse(params, data, 4)));
      }

      if (group === 0x03 && subfunction === 0x02) {
        const payloadBytes = Uint8Array.of(0x00, 0x65, 0x00, 0x00, 0x00, 0x66, 0x00, 0x00);
        const data = new Uint8Array(4 + payloadBytes.length);
        data.set([0xff, 0x09, 0x00, payloadBytes.length], 0);
        data.set(payloadBytes, 4);
        return Promise.resolve(wrapCotpDt(buildUserDataResponse(params, data, 5)));
      }

      if (group === 0x04 && subfunction === 0x01) {
        const szlPayload = Uint8Array.of(
          0x00,
          0x1c,
          0x00,
          0x00,
          // ModuleTypeName (32)
          ...Array.from({ length: 32 }, (_v, i) => (i < 6 ? "CPU151".charCodeAt(i) : 0x00)),
          // SerialNumber (24)
          ...Array.from({ length: 24 }, (_v, i) => (i < 8 ? "SERIAL01".charCodeAt(i) : 0x00)),
          // ASName (24)
          ...Array.from({ length: 24 }, (_v, i) => (i < 5 ? "AS-01".charCodeAt(i) : 0x00)),
          // Copyright (26)
          ...Array.from({ length: 26 }, (_v, i) => (i < 7 ? "SIEMENS".charCodeAt(i) : 0x00)),
          // ModuleName (24)
          ...Array.from({ length: 24 }, (_v, i) => (i < 10 ? "MODULE-XYZ".charCodeAt(i) : 0x00))
        );
        const userDataParams = Uint8Array.of(0x00, 0x01, 0x12, 0x08, 0x12, 0x44, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00);
        const data = new Uint8Array(4 + szlPayload.length);
        data.set([0xff, 0x09, (szlPayload.length >> 8) & 0xff, szlPayload.length & 0xff], 0);
        data.set(szlPayload, 4);
        return Promise.resolve(wrapCotpDt(buildUserDataResponse(userDataParams, data, 14)));
      }

      if (group === 0x07 && subfunction === 0x01) {
        const payloadBytes = Uint8Array.of(0x00, 0x26, 0x04, 0x13, 0x10, 0x20, 0x30, 0x01);
        const userDataParams = Uint8Array.of(0x00, 0x01, 0x12, 0x08, 0x12, 0x47, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00);
        const data = new Uint8Array(4 + payloadBytes.length);
        data.set([0xff, 0x09, 0x00, payloadBytes.length], 0);
        data.set(payloadBytes, 4);
        return Promise.resolve(wrapCotpDt(buildUserDataResponse(userDataParams, data, 15)));
      }

      if (group === 0x07 && subfunction === 0x02) {
        const userDataParams = Uint8Array.of(0x00, 0x01, 0x12, 0x08, 0x12, 0x47, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00);
        const data = Uint8Array.of(0xff, 0x09, 0x00, 0x00);
        return Promise.resolve(wrapCotpDt(buildUserDataResponse(userDataParams, data, 16)));
      }

      const payloadBytes = new Uint8Array(78);
      payloadBytes[1] = 0x41;
      payloadBytes[10] = 0x01;
      new DataView(payloadBytes.buffer).setUint16(12, 7, false);
      new DataView(payloadBytes.buffer).setUint32(14, 512, false);
      new DataView(payloadBytes.buffer).setUint16(34, 4, false);
      new DataView(payloadBytes.buffer).setUint16(38, 5, false);
      new DataView(payloadBytes.buffer).setUint16(40, 6, false);
      payloadBytes.set(Uint8Array.from([0x41, 0x55, 0x54, 0x48, 0x4f, 0x52, 0x20, 0x20]), 42);
      payloadBytes[66] = 0x03;
      new DataView(payloadBytes.buffer).setUint16(68, 0x1234, false);

      const data = new Uint8Array(4 + payloadBytes.length);
      data.set([0xff, 0x09, 0x00, payloadBytes.length], 0);
      data.set(payloadBytes, 4);
      return Promise.resolve(wrapCotpDt(buildUserDataResponse(params, data, 6)));
    }

    const fn = s7Request[10];

    if (fn === S7Function.SETUP_COMMUNICATION) {
      const params = new Uint8Array(8);
      const view = new DataView(params.buffer);
      view.setUint8(0, S7Function.SETUP_COMMUNICATION);
      view.setUint8(1, 0x00);
      view.setUint16(2, 1, false);
      view.setUint16(4, 1, false);
      view.setUint16(6, 960, false);
      return Promise.resolve(wrapCotpDt(buildS7Response(params, new Uint8Array(0), 1)));
    }

    if (fn === S7Function.READ_AREA) {
      const params = Uint8Array.of(S7Function.READ_AREA, 0x01);
      const data = Uint8Array.of(0xff, 0x04, 0x00, 0x18, 0xaa, 0xbb, 0xcc);
      return Promise.resolve(wrapCotpDt(buildS7Response(params, data, 2)));
    }

    if (fn === 0x1d) {
      const params = Uint8Array.of(0x1d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x06, 0x30, 0x30, 0x30, 0x30, 0x31, 0x36);
      return Promise.resolve(wrapCotpDt(buildS7Response(params, new Uint8Array(0), 7)));
    }

    if (fn === 0x1e) {
      const params = Uint8Array.of(0x1e, 0x00);
      const data = Uint8Array.of(0xff, 0x04, 0x00, 0x20, 0xde, 0xad, 0xbe, 0xef);
      return Promise.resolve(wrapCotpDt(buildS7Response(params, data, 8)));
    }

    if (fn === 0x1f) {
      const params = Uint8Array.of(0x1f, 0x00);
      return Promise.resolve(wrapCotpDt(buildS7Response(params, Uint8Array.of(0xff), 9)));
    }

    if (fn === 0x1a) {
      const params = Uint8Array.of(0x1a, 0x00);
      return Promise.resolve(wrapCotpDt(buildS7Response(params, Uint8Array.of(0xff), 10)));
    }

    if (fn === 0x1b) {
      const params = Uint8Array.of(0x1b, 0x00);
      return Promise.resolve(wrapCotpDt(buildS7Response(params, Uint8Array.of(0xff), 11)));
    }

    if (fn === 0x1c) {
      const params = Uint8Array.of(0x1c, 0x00);
      return Promise.resolve(wrapCotpDt(buildS7Response(params, Uint8Array.of(0xff), 12)));
    }

    if (fn === 0x28) {
      const params = Uint8Array.of(0x28, 0x00);
      return Promise.resolve(wrapCotpDt(buildS7Response(params, Uint8Array.of(0xff), 13)));
    }

    const writeParams = Uint8Array.of(S7Function.WRITE_AREA, 0x01);
    const writeData = Uint8Array.of(0xff);
    return Promise.resolve(wrapCotpDt(buildS7Response(writeParams, writeData, 3)));
  }

  public disconnect(): void {
    this.connected = false;
  }
}

describe("LegacyS7AsyncClient", () => {
  it("connects, negotiates pdu length, reads and writes DB", async () => {
    const transport = new FakeLegacyTransport();
    const client = new LegacyS7AsyncClient(transport);

    await client.connect({
      address: "127.0.0.1",
      rack: 0,
      slot: 1,
      timeoutMs: 200
    });

    expect(client.connected).toBe(true);
    expect(client.negotiatedPduLength).toBe(960);

    const read = await client.dbRead(1, 0, 3);
    expect(Array.from(read)).toEqual([0xaa, 0xbb, 0xcc]);

    await expect(client.dbWrite(1, 0, Uint8Array.of(1, 2, 3))).resolves.toBeUndefined();
    expect(transport.requests.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects DB read/write when not connected", async () => {
    const client = new LegacyS7AsyncClient(new FakeLegacyTransport());
    await expect(client.dbRead(1, 0, 1)).rejects.toBeInstanceOf(Snap7ConnectionError);
    await expect(client.dbWrite(1, 0, Uint8Array.of(1))).rejects.toBeInstanceOf(Snap7ConnectionError);
  });

  it("supports list blocks, list blocks of type, and get block info", async () => {
    const transport = new FakeLegacyTransport();
    const client = new LegacyS7AsyncClient(transport);
    await client.connect({ address: "127.0.0.1", rack: 0, slot: 1 });

    const list = await client.listBlocks();
    expect(list.DBCount).toBe(2);
    expect(list.OBCount).toBe(1);

    const dbBlocks = await client.listBlocksOfType(Block.DB, 10);
    expect(dbBlocks).toEqual([101, 102]);

    const info = await client.getBlockInfo(Block.DB, 7);
    expect(info.BlkType).toBe(0x41);
    expect(info.BlkNumber).toBe(7);
    expect(info.MC7Size).toBe(6);
  });

  it("parses PG block info from raw bytes", () => {
    const client = new LegacyS7AsyncClient(new FakeLegacyTransport());
    const data = new Uint8Array(36);
    data[4] = 0x01;
    data[5] = 0x41;
    new DataView(data.buffer).setUint16(6, 10, false);
    new DataView(data.buffer).setUint32(8, 111, false);
    new DataView(data.buffer).setUint32(12, 222, false);
    new DataView(data.buffer).setUint32(28, 333, false);
    new DataView(data.buffer).setUint16(32, 0xabcd, false);
    data[34] = 9;

    const info = client.getPgBlockInfo(data);
    expect(info.BlkType).toBe(0x41);
    expect(info.BlkNumber).toBe(10);
    expect(info.MC7Size).toBe(111);
    expect(info.Version).toBe(9);
  });

  it("supports upload/fullUpload/download/delete flows", async () => {
    const transport = new FakeLegacyTransport();
    const client = new LegacyS7AsyncClient(transport);
    await client.connect({ address: "127.0.0.1", rack: 0, slot: 1 });

    const uploaded = await client.upload(1);
    expect(Array.from(uploaded)).toEqual([0xde, 0xad, 0xbe, 0xef]);

    const [fullBlock, size] = await client.fullUpload(Block.DB, 1);
    expect(size).toBe(fullBlock.length);
    expect(fullBlock[0]).toBe(0x70);
    expect(fullBlock[1]).toBe(Block.DB);

    await expect(client.download(Uint8Array.of(1, 2, 3, 4), 1)).resolves.toBe(0);
    await expect(client.delete(Block.DB, 1)).resolves.toBe(0);
  });

  it("supports plc control, clock and szl-derived info APIs", async () => {
    const transport = new FakeLegacyTransport();
    const client = new LegacyS7AsyncClient(transport);
    await client.connect({ address: "127.0.0.1", rack: 0, slot: 1 });

    await expect(client.plcStop()).resolves.toBe(0);
    await expect(client.plcHotStart()).resolves.toBe(0);
    await expect(client.plcColdStart()).resolves.toBe(0);

    const dt = await client.getPlcDatetime();
    expect(dt.getFullYear()).toBe(2026);
    await expect(client.setPlcDatetime(new Date(2026, 3, 13, 11, 22, 33))).resolves.toBe(0);

    const cpuState = await client.getCpuState();
    expect(cpuState).toBe("S7CpuStatusRun");

    const cpuInfo = await client.getCpuInfo();
    expect(cpuInfo.ModuleTypeName).toContain("CPU151");

    const cpInfo = await client.getCpInfo();
    expect(cpInfo.MaxPduLength).toBeGreaterThanOrEqual(0);

    const orderCode = await client.getOrderCode();
    expect(orderCode.OrderCode).toBeTypeOf("string");

    const protection = await client.getProtection();
    expect(protection.sch_schal).toBeGreaterThanOrEqual(0);

    const szl = await client.readSzl(0x001c, 0);
    expect(szl.Header.LengthDR).toBeGreaterThan(0);
  });

  it("supports raw iso exchange buffer passthrough", async () => {
    const transport = new FakeLegacyTransport();
    const client = new LegacyS7AsyncClient(transport);
    await client.connect({ address: "127.0.0.1", rack: 0, slot: 1 });

    const payload = Uint8Array.of(0x02, 0xf0, 0x80, 0x32, 0x01, 0x00, 0x00);
    const response = await client.isoExchangeBuffer(payload);
    // Raw iso exchange should return transport-level response (including COTP DT header).
    expect(response[0]).toBe(0x02);
    expect(response[1]).toBe(0xf0);
  });
});
