import { describe, expect, it } from "vitest";

import { AsyncClient, type LegacyClientLike, type S7CommPlusClientLike } from "../src/client/async/async-client.js";
import { Area, WordLen } from "../src/types.js";

class MultiVarLegacyClient implements LegacyClientLike {
  public connected = false;
  public negotiatedPduLength = 960;
  public readAreaCalls: Array<{ area: number; dbNumber: number; start: number; amount: number; wordLen: number }> = [];
  public writeAreaCalls: Array<{ area: number; dbNumber: number; start: number; data: Uint8Array; wordLen: number }> = [];

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
    this.readAreaCalls.push({ area, dbNumber, start, amount, wordLen });
    return Promise.resolve(new Uint8Array(amount).fill(start & 0xff));
  }

  public writeArea(area: number, dbNumber: number, start: number, data: Uint8Array, wordLen: number): Promise<void> {
    this.writeAreaCalls.push({ area, dbNumber, start, data, wordLen });
    return Promise.resolve();
  }

  public dbRead(_dbNumber: number, _start: number, size: number): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(size));
  }

  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    void dbNumber;
    void start;
    void data;
    return Promise.resolve();
  }
}

class MultiVarPlusClient implements S7CommPlusClientLike {
  public connected = false;

  public connect(_options: {
    host: string;
    port?: number;
    useTls?: boolean;
    tlsCert?: string;
    tlsKey?: string;
    tlsCa?: string;
  }): Promise<void> {
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
    return Promise.resolve(items.map((item) => new Uint8Array(item[2]).fill(0xbb)));
  }
}

describe("AsyncClient Task 12 multi-variable operations", () => {
  it("returns success for empty input lists", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new MultiVarLegacyClient(),
      createS7CommPlusClient: () => new MultiVarPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await expect(client.readMultiVars([])).resolves.toEqual({ result: 0, items: [] });
    await expect(client.writeMultiVars([])).resolves.toBe(0);
  });

  it("supports mixed-area multi read/write in legacy mode", async () => {
    const legacy = new MultiVarLegacyClient();
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => new MultiVarPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    const read = await client.readMultiVars([
      { area: Area.DB, dbNumber: 1, start: 0, size: 4, wordLen: WordLen.Byte },
      { area: Area.MK, start: 2, size: 2 },
      { area: Area.PE, start: 1, size: 1 }
    ]);
    expect(read.result).toBe(0);
    expect(read.items).toHaveLength(3);
    expect(legacy.readAreaCalls).toHaveLength(3);

    const writeResult = await client.writeMultiVars([
      { area: Area.DB, dbNumber: 1, start: 0, data: Uint8Array.of(1, 2, 3) },
      { area: Area.MK, start: 5, data: Uint8Array.of(9, 8) }
    ]);
    expect(writeResult).toBe(0);
    expect(legacy.writeAreaCalls).toHaveLength(2);
  });

  it("enforces MAX_VARS boundary checks", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new MultiVarLegacyClient(),
      createS7CommPlusClient: () => new MultiVarPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    const okReadItems = Array.from({ length: 20 }, (_unused, i) => ({
      area: Area.DB,
      dbNumber: 1,
      start: i,
      size: 1
    }));
    await expect(client.readMultiVars(okReadItems)).resolves.toMatchObject({ result: 0 });

    const overflowReadItems = Array.from({ length: 21 }, (_unused, i) => ({
      area: Area.DB,
      dbNumber: 1,
      start: i,
      size: 1
    }));
    await expect(client.readMultiVars(overflowReadItems)).rejects.toThrow(/exceeds MAX_VARS/i);

    const overflowWriteItems = Array.from({ length: 21 }, (_unused, i) => ({
      area: Area.DB,
      dbNumber: 1,
      start: i,
      data: Uint8Array.of(1)
    }));
    await expect(client.writeMultiVars(overflowWriteItems)).rejects.toThrow(/exceeds MAX_VARS/i);
  });

  it("inherits protocol restrictions in s7commplus mode", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new MultiVarLegacyClient(),
      createS7CommPlusClient: () => new MultiVarPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "s7commplus" });

    await expect(
      client.readMultiVars([{ area: Area.MK, start: 0, size: 1, wordLen: WordLen.Byte }])
    ).rejects.toThrow(/supports DB byte reads only/i);
  });
});
