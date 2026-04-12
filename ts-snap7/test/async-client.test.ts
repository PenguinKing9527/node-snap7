import { describe, expect, it } from "vitest";

import { AsyncClient, type LegacyClientLike, type S7CommPlusClientLike } from "../src/client/async/async-client.js";
import { Snap7ConnectionError } from "../src/errors/index.js";

class FakeLegacyClient implements LegacyClientLike {
  public connected = false;
  public connectCalls = 0;
  public readCalls: Array<{ dbNumber: number; start: number; size: number }> = [];
  public writeCalls: Array<{ dbNumber: number; start: number; data: Uint8Array }> = [];

  public connect(_options: { address: string; rack?: number; slot?: number; tcpPort?: number }): Promise<void> {
    void _options;
    this.connectCalls += 1;
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  public dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array> {
    this.readCalls.push({ dbNumber, start, size });
    return Promise.resolve(Uint8Array.of(dbNumber & 0xff, start & 0xff, size & 0xff));
  }

  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    this.writeCalls.push({ dbNumber, start, data });
    return Promise.resolve();
  }
}

class FakeS7CommPlusClient implements S7CommPlusClientLike {
  public connected = false;
  public connectCalls = 0;
  public readCalls: Array<{ dbNumber: number; start: number; size: number }> = [];
  public writeCalls: Array<{ dbNumber: number; start: number; data: Uint8Array }> = [];
  public readMultiCalls: Array<Array<readonly [number, number, number]>> = [];

  public connect(_options: { host: string; port?: number }): Promise<void> {
    void _options;
    this.connectCalls += 1;
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): void {
    this.connected = false;
  }

  public dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array> {
    this.readCalls.push({ dbNumber, start, size });
    return Promise.resolve(Uint8Array.of(0xee, dbNumber & 0xff, size & 0xff));
  }

  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    this.writeCalls.push({ dbNumber, start, data });
    return Promise.resolve();
  }

  public dbReadMulti(items: Array<readonly [number, number, number]>): Promise<Uint8Array[]> {
    this.readMultiCalls.push(items);
    return Promise.resolve(items.map((item) => Uint8Array.of(item[0] & 0xff, item[1] & 0xff, item[2] & 0xff)));
  }
}

describe("AsyncClient (Task 6 unified routing)", () => {
  it("routes legacy protocol operations to LegacyS7AsyncClient", async () => {
    const legacy = new FakeLegacyClient();
    const plus = new FakeS7CommPlusClient();
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => plus
    });

    await client.connect({ address: "127.0.0.1", protocol: "legacy" });
    expect(client.protocol).toBe("legacy");
    expect(legacy.connectCalls).toBe(1);
    expect(plus.connectCalls).toBe(0);

    const read = await client.dbRead(1, 0, 4);
    expect(Array.from(read)).toEqual([1, 0, 4]);
    await expect(client.dbWrite(1, 2, Uint8Array.of(1, 2, 3))).resolves.toBeUndefined();

    const multi = await client.dbReadMulti([
      { dbNumber: 2, start: 0, size: 1 },
      { dbNumber: 3, start: 4, size: 2 }
    ]);
    expect(Array.from(multi[0] ?? new Uint8Array())).toEqual([2, 0, 1]);
    expect(Array.from(multi[1] ?? new Uint8Array())).toEqual([3, 4, 2]);
  });

  it("routes s7commplus protocol operations to S7CommPlusAsyncClient", async () => {
    const legacy = new FakeLegacyClient();
    const plus = new FakeS7CommPlusClient();
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => plus
    });

    await client.connect({ address: "127.0.0.1", protocol: "s7commplus" });
    expect(client.protocol).toBe("s7commplus");
    expect(plus.connectCalls).toBe(1);
    expect(legacy.connectCalls).toBe(0);

    const read = await client.dbRead(10, 8, 2);
    expect(Array.from(read)).toEqual([0xee, 10, 2]);
    await expect(client.dbWrite(10, 8, Uint8Array.of(5, 6))).resolves.toBeUndefined();

    const multi = await client.dbReadMulti([{ dbNumber: 10, start: 8, size: 2 }]);
    expect(Array.from(multi[0] ?? new Uint8Array())).toEqual([10, 8, 2]);
  });

  it("uses s7commplus first in auto mode and falls back to legacy on connect failure", async () => {
    const legacy = new FakeLegacyClient();
    const plus = new FakeS7CommPlusClient();
    plus.connect = (_options: { host: string; port?: number }) => {
      void _options;
      plus.connectCalls += 1;
      return Promise.reject(new Snap7ConnectionError("plus unavailable"));
    };

    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => plus
    });

    await client.connect({ address: "127.0.0.1", protocol: "auto" });
    expect(client.protocol).toBe("legacy");
    expect(plus.connectCalls).toBe(1);
    expect(legacy.connectCalls).toBe(1);
  });

  it("rejects read/write APIs before connect", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new FakeLegacyClient(),
      createS7CommPlusClient: () => new FakeS7CommPlusClient()
    });

    await expect(client.dbRead(1, 0, 1)).rejects.toBeInstanceOf(Snap7ConnectionError);
    await expect(client.dbWrite(1, 0, Uint8Array.of(1))).rejects.toBeInstanceOf(Snap7ConnectionError);
    await expect(client.dbReadMulti([])).rejects.toBeInstanceOf(Snap7ConnectionError);
  });

  it("returns empty result for legacy dbReadMulti when input list is empty", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new FakeLegacyClient(),
      createS7CommPlusClient: () => new FakeS7CommPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await expect(client.dbReadMulti([])).resolves.toEqual([]);
  });

  it("surfaces combined error details when auto mode cannot connect any protocol", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => ({
        connect: (_options: { address: string; rack?: number; slot?: number; tcpPort?: number }) => {
          void _options;
          return Promise.reject(new Snap7ConnectionError("legacy failed"));
        },
        disconnect: () => Promise.resolve(),
        dbRead: () => Promise.resolve(new Uint8Array()),
        dbWrite: () => Promise.resolve()
      }),
      createS7CommPlusClient: () => ({
        connect: (_options: { host: string; port?: number }) => {
          void _options;
          return Promise.reject(new Snap7ConnectionError("plus failed"));
        },
        disconnect: () => undefined,
        dbRead: () => Promise.resolve(new Uint8Array()),
        dbWrite: () => Promise.resolve(),
        dbReadMulti: () => Promise.resolve([])
      })
    });

    await expect(client.connect({ address: "127.0.0.1", protocol: "auto" })).rejects.toThrow(
      "Auto protocol negotiation failed"
    );
  });
});
