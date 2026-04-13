import { describe, expect, it } from "vitest";

import { AsyncClient, type LegacyClientLike, type S7CommPlusClientLike } from "../src/client/async/async-client.js";

class TypedDbLegacyClient implements LegacyClientLike {
  public connected = false;
  public negotiatedPduLength = 960;
  public lastReadSize = 0;
  private readonly db = new Map<number, Uint8Array>();

  public connect(_options: { address: string; rack?: number; slot?: number; tcpPort?: number }): Promise<void> {
    void _options;
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  public dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array> {
    this.lastReadSize = size;
    const memory = this.ensureDb(dbNumber, start + size);
    return Promise.resolve(memory.slice(start, start + size));
  }

  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    const memory = this.ensureDb(dbNumber, start + data.length);
    memory.set(data, start);
    return Promise.resolve();
  }

  private ensureDb(dbNumber: number, minSize: number): Uint8Array {
    const existing = this.db.get(dbNumber);
    if (existing !== undefined && existing.length >= minSize) {
      return existing;
    }
    const nextSize = Math.max(minSize, existing?.length ?? 256);
    const memory = new Uint8Array(nextSize);
    if (existing !== undefined) {
      memory.set(existing);
    }
    this.db.set(dbNumber, memory);
    return memory;
  }
}

class NoopPlusClient implements S7CommPlusClientLike {
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
    return Promise.resolve(new Uint8Array(size));
  }

  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    void dbNumber;
    void start;
    void data;
    return Promise.resolve();
  }

  public dbReadMulti(items: Array<readonly [number, number, number]>): Promise<Uint8Array[]> {
    return Promise.resolve(items.map((it) => new Uint8Array(it[2])));
  }
}

describe("AsyncClient Task 11 typed DB helpers", () => {
  it("roundtrips scalar numeric DB helpers", async () => {
    const legacy = new TypedDbLegacyClient();
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => new NoopPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await client.dbWriteByte(1, 0, 0xab);
    await client.dbWriteInt(1, 2, -1234);
    await client.dbWriteUint(1, 4, 65530);
    await client.dbWriteDint(1, 6, -12345678);
    await client.dbWriteUdint(1, 10, 3234567890);
    await client.dbWriteReal(1, 14, 12.5);
    await client.dbWriteLreal(1, 18, 1234.5678);

    expect(await client.dbReadByte(1, 0)).toBe(0xab);
    expect(await client.dbReadInt(1, 2)).toBe(-1234);
    expect(await client.dbReadUint(1, 4)).toBe(65530);
    expect(await client.dbReadWord(1, 4)).toBe(65530);
    expect(await client.dbReadDint(1, 6)).toBe(-12345678);
    expect(await client.dbReadUdint(1, 10)).toBe(3234567890);
    expect(await client.dbReadDword(1, 10)).toBe(3234567890);
    expect(await client.dbReadReal(1, 14)).toBeCloseTo(12.5, 4);
    expect(await client.dbReadLreal(1, 18)).toBeCloseTo(1234.5678, 6);
  });

  it("reads and writes BOOL with bit preservation and boundary checks", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new TypedDbLegacyClient(),
      createS7CommPlusClient: () => new NoopPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await client.dbWriteByte(1, 30, 0b0101_0000);
    await client.dbWriteBool(1, 30, 0, true);
    await client.dbWriteBool(1, 30, 6, false);
    expect(await client.dbReadByte(1, 30)).toBe(0b0001_0001);
    expect(await client.dbReadBool(1, 30, 4)).toBe(true);

    await expect(client.dbReadBool(1, 30, 8)).rejects.toThrow(/Bit offset must be 0-7/i);
  });

  it("supports STRING and WSTRING helpers including truncation behavior", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new TypedDbLegacyClient(),
      createS7CommPlusClient: () => new NoopPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await client.dbWriteString(1, 40, "HELLO", 10);
    await client.dbWriteWstring(1, 80, "ABC中文", 6);
    expect(await client.dbReadString(1, 40)).toBe("HELLO");
    expect(await client.dbReadWstring(1, 80)).toBe("ABC中文");

    await client.dbWriteString(1, 120, "TOO-LONG", 3);
    await client.dbWriteWstring(1, 140, "LONG-WSTRING", 4);
    expect(await client.dbReadString(1, 120)).toBe("TOO");
    expect(await client.dbReadWstring(1, 140)).toBe("LONG");
  });

  it("supports dbGet/dbFill explicit size and fallback size", async () => {
    const legacy = new TypedDbLegacyClient();
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => new NoopPlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await client.dbFill(2, 0xaa, 16);
    const filled = await client.dbGet(2, 16);
    expect(filled).toHaveLength(16);
    expect(Array.from(filled)).toEqual(new Array(16).fill(0xaa));

    await client.dbGet(2, 0);
    expect(legacy.lastReadSize).toBe(65536);
  });
});
