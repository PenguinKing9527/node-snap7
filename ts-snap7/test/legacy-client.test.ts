import { describe, expect, it } from "vitest";

import { Snap7ConnectionError } from "../src/errors/index.js";
import { LegacyS7AsyncClient, S7Function, S7PduType } from "../src/s7/legacy/index.js";
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
});
