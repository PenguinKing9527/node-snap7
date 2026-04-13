import { describe, expect, it } from "vitest";

import { FunctionCode, encodeHeader, encodeRequestHeader } from "../src/core/index.js";
import { S7CommPlusConnection } from "../src/s7/plus/index.js";
import type { PlusTransport } from "../src/s7/plus/index.js";
import type { TransportConnectOptions, TransportRequestOptions } from "../src/transport/types.js";

const wrapCotpDt = (payload: Uint8Array): Uint8Array => {
  const out = new Uint8Array(3 + payload.length);
  out.set([0x02, 0xf0, 0x80], 0);
  out.set(payload, 3);
  return out;
};

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

class FakePlusTransport implements PlusTransport {
  public requests: Uint8Array[] = [];
  public connectOptions: TransportConnectOptions | null = null;
  public tlsActivated = false;

  public connect(options: TransportConnectOptions): Promise<void> {
    this.connectOptions = options;
    return Promise.resolve();
  }

  public activateTls(): Promise<void> {
    this.tlsActivated = true;
    return Promise.resolve();
  }

  public getTlsExporterSecret(): Uint8Array | null {
    return Uint8Array.of(0xde, 0xad, 0xbe, 0xef);
  }

  public request(payload: Uint8Array, _options?: TransportRequestOptions): Promise<Uint8Array> {
    void _options;
    this.requests.push(payload);

    // Payload is COTP DT + S7CommPlus frame.
    const frame = payload.slice(3);
    const body = frame.slice(4); // strip plus frame header
    const fn = new DataView(body.buffer, body.byteOffset, body.length).getUint16(3, false);

    if (fn === (FunctionCode.INIT_SSL as number)) {
      const respHeader = encodeRequestHeader(FunctionCode.INIT_SSL, 1, 0, 0x30);
      return Promise.resolve(wrapCotpDt(concat(encodeHeader(1, respHeader.length), respHeader)));
    }
    if (fn === (FunctionCode.CREATE_OBJECT as number)) {
      const respHeader = encodeRequestHeader(FunctionCode.CREATE_OBJECT, 2, 0x12345678, 0x36);
      return Promise.resolve(wrapCotpDt(concat(encodeHeader(1, respHeader.length), respHeader)));
    }

    const respHeader = encodeRequestHeader(fn, 3, 0x12345678, 0x36);
    const payloadData = Uint8Array.of(0x99, 0x88);
    return Promise.resolve(wrapCotpDt(concat(encodeHeader(1, respHeader.length + payloadData.length), respHeader, payloadData)));
  }

  public disconnect(): void {
    // no-op for tests
  }
}

describe("S7CommPlusConnection", () => {
  it("connects through initSsl/createSession and sends requests", async () => {
    const transport = new FakePlusTransport();
    const connection = new S7CommPlusConnection(transport);

    await connection.connect({ host: "127.0.0.1", port: 102 });
    expect(connection.connected).toBe(true);
    expect(connection.sessionSetupOk).toBe(true);
    expect(connection.sessionId).toBe(0x12345678);
    expect(transport.connectOptions?.remoteTsap).toBeInstanceOf(Uint8Array);

    const response = await connection.sendRequest(FunctionCode.GET_MULTI_VARIABLES, Uint8Array.of(0xaa));
    expect(Array.from(response)).toEqual([0x99, 0x88]);
  });

  it("activates TLS and exports OMS secret when requested", async () => {
    const transport = new FakePlusTransport();
    const connection = new S7CommPlusConnection(transport);

    await connection.connect({ host: "127.0.0.1", port: 102, useTls: true });
    expect(transport.tlsActivated).toBe(true);
    expect(connection.tlsActive).toBe(true);
    expect(Array.from(connection.omsSecret ?? new Uint8Array())).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});
