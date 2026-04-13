import { describe, expect, it } from "vitest";

import { DataType, FunctionCode, encodePvalueBlob, encodeUint32Vlq, encodeUint64Vlq } from "../src/core/index.js";
import { S7CommPlusAsyncClient } from "../src/s7/plus/index.js";
import type { S7CommPlusConnectionLike } from "../src/s7/plus/index.js";

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

class FakeConnection implements S7CommPlusConnectionLike {
  public connected = false;
  public sessionSetupOk = false;
  public sessionId = 0;
  public protocolVersion = 1;
  public tlsActive = true;
  public omsSecret: Uint8Array | null = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
  public sentFunctions: number[] = [];

  public connect(_options: {
    host: string;
    port?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    useTls?: boolean;
    tlsCert?: string;
    tlsKey?: string;
    tlsCa?: string;
  }): Promise<void> {
    void _options;
    this.connected = true;
    this.sessionSetupOk = true;
    this.sessionId = 0x1234;
    return Promise.resolve();
  }

  public disconnect(): void {
    this.connected = false;
  }

  public sendRequest(functionCode: number): Promise<Uint8Array> {
    this.sentFunctions.push(functionCode);
    if (functionCode === (FunctionCode.GET_MULTI_VARIABLES as number)) {
      return Promise.resolve(
        concat(
        encodeUint64Vlq(0n),
        encodeUint32Vlq(1),
        encodePvalueBlob(Uint8Array.of(1, 2, 3)),
        encodeUint32Vlq(2),
        Uint8Array.of(0x00, DataType.USINT, 0x2a),
        encodeUint32Vlq(0),
        encodeUint32Vlq(0)
      )
      );
    }
    if (functionCode === (FunctionCode.GET_VAR_SUBSTREAMED as number)) {
      return Promise.resolve(
        concat(
          encodeUint64Vlq(0n),
          Uint8Array.of(0x00, DataType.BLOB),
          encodeUint32Vlq(16),
          Uint8Array.from({ length: 16 }, (_, i) => i + 1)
        )
      );
    }
    if (functionCode === (FunctionCode.SET_VARIABLE as number)) {
      return Promise.resolve(encodeUint64Vlq(0n));
    }
    return Promise.resolve(concat(encodeUint64Vlq(0n), encodeUint32Vlq(0)));
  }
}

describe("S7CommPlusAsyncClient", () => {
  it("connects and performs dbRead/dbWrite/dbReadMulti", async () => {
    const connection = new FakeConnection();
    const client = new S7CommPlusAsyncClient(connection);

    await client.connect({ host: "127.0.0.1" });
    expect(client.connected).toBe(true);
    expect(client.sessionSetupOk).toBe(true);

    const read = await client.dbRead(1, 0, 3);
    expect(Array.from(read)).toEqual([1, 2, 3]);

    await expect(client.dbWrite(1, 0, Uint8Array.of(9, 8, 7))).resolves.toBeUndefined();

    const multi = await client.dbReadMulti([
      [1, 0, 3] as const,
      [2, 4, 1] as const
    ]);
    expect(Array.from(multi[0]!)).toEqual([1, 2, 3]);
    expect(Array.from(multi[1]!)).toEqual([0x2a]);
  });

  it("performs authenticate legitimation flow when TLS is active", async () => {
    const connection = new FakeConnection();
    const client = new S7CommPlusAsyncClient(connection);

    await client.connect({ host: "127.0.0.1", useTls: true });
    await expect(client.authenticate("plc-password")).resolves.toBeUndefined();

    expect(connection.sentFunctions).toContain(FunctionCode.GET_VAR_SUBSTREAMED);
    expect(connection.sentFunctions.filter((fn) => fn === Number(FunctionCode.SET_VARIABLE)).length).toBeGreaterThan(0);
  });

  it("rejects authenticate without TLS exporter secret", async () => {
    const connection = new FakeConnection();
    connection.tlsActive = false;
    connection.omsSecret = null;
    const client = new S7CommPlusAsyncClient(connection);

    await client.connect({ host: "127.0.0.1" });
    await expect(client.authenticate("plc-password")).rejects.toThrow(/requires TLS/i);
  });
});
