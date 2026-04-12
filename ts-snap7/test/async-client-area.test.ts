import { describe, expect, it } from "vitest";

import { AsyncClient, type LegacyClientLike, type S7CommPlusClientLike } from "../src/client/async/async-client.js";
import { Area, WordLen } from "../src/types.js";

class AreaLegacyClient implements LegacyClientLike {
  public connected = false;
  public negotiatedPduLength = 64;
  public readAreaCalls: Array<{ area: Area; dbNumber: number; start: number; amount: number; wordLen: WordLen }> = [];
  public writeAreaCalls: Array<{ area: Area; dbNumber: number; start: number; data: Uint8Array; wordLen: WordLen }> = [];

  public connect(_options: { address: string; rack?: number; slot?: number; tcpPort?: number }): Promise<void> {
    void _options;
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  public readArea(area: number, dbNumber: number, start: number, amount: number, wordLen: number): Promise<Uint8Array> {
    const typedWordLen = wordLen as WordLen;
    this.readAreaCalls.push({ area: area as Area, dbNumber, start, amount, wordLen: typedWordLen });
    const bytesPerElement = typedWordLen === WordLen.Counter || typedWordLen === WordLen.Timer ? 2 : 1;
    return Promise.resolve(new Uint8Array(amount * bytesPerElement).fill(start & 0xff));
  }

  public writeArea(area: number, dbNumber: number, start: number, data: Uint8Array, wordLen: number): Promise<void> {
    this.writeAreaCalls.push({ area: area as Area, dbNumber, start, data, wordLen: wordLen as WordLen });
    return Promise.resolve();
  }

  public dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array> {
    void dbNumber;
    return Promise.resolve(new Uint8Array(size).fill(start & 0xff));
  }

  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    void dbNumber;
    void start;
    void data;
    return Promise.resolve();
  }
}

class AreaPlusClient implements S7CommPlusClientLike {
  public connected = false;

  public connect(_options: { host: string; port?: number }): Promise<void> {
    void _options;
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): void {
    this.connected = false;
  }

  public dbRead(_dbNumber: number, _start: number, size: number): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(size).fill(0xaa));
  }

  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    void dbNumber;
    void start;
    void data;
    return Promise.resolve();
  }

  public dbReadMulti(items: Array<readonly [number, number, number]>): Promise<Uint8Array[]> {
    return Promise.resolve(items.map((item) => new Uint8Array(item[2])));
  }
}

describe("AsyncClient Task 10 area I/O and chunking", () => {
  it("chunks legacy readArea/writeArea requests according to negotiated PDU size", async () => {
    const legacy = new AreaLegacyClient();
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => new AreaPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    // PDU 64 => maxReadSize 46 bytes. 100 bytes should split into 46 + 46 + 8.
    const read = await client.readArea(Area.DB, 1, 0, 100, WordLen.Byte);
    expect(read.length).toBe(100);
    expect(legacy.readAreaCalls.map((c) => c.amount)).toEqual([46, 46, 8]);
    expect(legacy.readAreaCalls.map((c) => c.start)).toEqual([0, 46, 92]);

    // PDU 64 => maxWriteSize 29 bytes. 70 bytes should split into 29 + 29 + 12.
    await client.writeArea(Area.DB, 1, 0, new Uint8Array(70), WordLen.Byte);
    expect(legacy.writeAreaCalls.map((c) => c.data.length)).toEqual([29, 29, 12]);
    expect(legacy.writeAreaCalls.map((c) => c.start)).toEqual([0, 29, 58]);
  });

  it("supports area shortcut helpers for legacy mode", async () => {
    const legacy = new AreaLegacyClient();
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => new AreaPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await client.abRead(0, 4);
    await client.abWrite(0, Uint8Array.of(1, 2, 3, 4));
    await client.ebRead(2, 3);
    await client.ebWrite(2, 2, Uint8Array.of(9, 8, 7));
    await client.mbRead(4, 2);
    await client.mbWrite(4, 2, Uint8Array.of(5, 6, 7));
    await client.tmRead(0, 2);
    await client.tmWrite(0, 2, Uint8Array.of(1, 2, 3, 4));
    await client.ctRead(1, 2);
    await client.ctWrite(1, 2, Uint8Array.of(9, 8, 7, 6));

    expect(legacy.readAreaCalls.some((c) => c.area === Area.PA)).toBe(true);
    expect(legacy.readAreaCalls.some((c) => c.area === Area.PE)).toBe(true);
    expect(legacy.readAreaCalls.some((c) => c.area === Area.MK)).toBe(true);
    expect(legacy.readAreaCalls.some((c) => c.area === Area.TM && c.wordLen === WordLen.Timer)).toBe(true);
    expect(legacy.readAreaCalls.some((c) => c.area === Area.CT && c.wordLen === WordLen.Counter)).toBe(true);
  });

  it("restricts s7commplus area helpers to DB byte access", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new AreaLegacyClient(),
      createS7CommPlusClient: () => new AreaPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "s7commplus" });

    await expect(client.readArea(Area.DB, 1, 0, 4, WordLen.Byte)).resolves.toHaveLength(4);
    await expect(client.readArea(Area.MK, 0, 0, 1, WordLen.Byte)).rejects.toThrow(/supports DB byte reads only/i);
    await expect(client.writeArea(Area.MK, 0, 0, Uint8Array.of(1), WordLen.Byte)).rejects.toThrow(
      /supports DB byte writes only/i
    );
  });

  it("validates timer/counter write lengths", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new AreaLegacyClient(),
      createS7CommPlusClient: () => new AreaPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await expect(client.tmWrite(0, 2, Uint8Array.of(1, 2, 3))).rejects.toThrow(/doesn't match size/i);
    await expect(client.ctWrite(0, 2, Uint8Array.of(1, 2, 3))).rejects.toThrow(/doesn't match size/i);
  });
});
