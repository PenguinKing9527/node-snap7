import { describe, expect, it } from "vitest";

import { AsyncClient, type LegacyClientLike, type S7CommPlusClientLike } from "../src/client/async/async-client.js";
import { Snap7ConnectionError } from "../src/errors/index.js";

class FakeReliableLegacyClient implements LegacyClientLike {
  public connected = false;
  public connectCalls = 0;
  public disconnectCalls = 0;
  public readCalls = 0;
  public cpuStateCalls = 0;
  public operationTrace: string[] = [];

  public connect(): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
    return Promise.resolve();
  }

  public async dbRead(_dbNumber: number, _start: number, _size: number): Promise<Uint8Array> {
    void _dbNumber;
    void _start;
    void _size;
    this.readCalls += 1;
    this.operationTrace.push(`start-${this.readCalls}`);
    await new Promise((resolve) => {
      setTimeout(resolve, 15);
    });
    if (this.readCalls === 1) {
      this.operationTrace.push("fail-1");
      throw new Snap7ConnectionError("Socket closed");
    }
    this.operationTrace.push(`end-${this.readCalls}`);
    return Uint8Array.of(0xaa);
  }

  public dbWrite(_dbNumber: number, _start: number, _data: Uint8Array): Promise<void> {
    void _dbNumber;
    void _start;
    void _data;
    return Promise.resolve();
  }

  public getCpuState(): Promise<string> {
    this.cpuStateCalls += 1;
    return Promise.resolve("S7CpuStatusRun");
  }
}

class FakePlusClient implements S7CommPlusClientLike {
  public connected = false;

  public connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): void {
    this.connected = false;
  }

  public dbRead(): Promise<Uint8Array> {
    return Promise.resolve(Uint8Array.of(0x01));
  }

  public dbWrite(): Promise<void> {
    return Promise.resolve();
  }

  public dbReadMulti(): Promise<Uint8Array[]> {
    return Promise.resolve([]);
  }
}

describe("AsyncClient Task 17 reliability", () => {
  it("reconnects and retries read operation when auto reconnect is enabled", async () => {
    const legacy = new FakeReliableLegacyClient();
    const reconnectAttempts: number[] = [];
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => new FakePlusClient(),
      reliability: {
        autoReconnect: true,
        maxReconnectAttempts: 2,
        reconnectInitialDelayMs: 1,
        reconnectBackoffFactor: 1,
        reconnectMaxDelayMs: 2
      },
      hooks: {
        onReconnect: (attempt) => {
          reconnectAttempts.push(attempt);
        }
      }
    });

    await client.connect({ address: "127.0.0.1", protocol: "legacy" });
    const data = await client.dbRead(1, 0, 1);
    expect(Array.from(data)).toEqual([0xaa]);
    expect(reconnectAttempts.length).toBeGreaterThanOrEqual(1);
    expect(legacy.connectCalls).toBeGreaterThanOrEqual(2);
  });

  it("runs heartbeat probe and serializes concurrent operations", async () => {
    const legacy = new FakeReliableLegacyClient();
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => new FakePlusClient(),
      reliability: {
        autoReconnect: false,
        heartbeatIntervalMs: 20
      }
    });

    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    const read1 = client.dbRead(1, 0, 1).catch(() => Uint8Array.of(0x00));
    const read2 = client.dbRead(1, 1, 1).catch(() => Uint8Array.of(0x00));
    await Promise.all([read1, read2]);

    await new Promise((resolve) => {
      setTimeout(resolve, 70);
    });

    expect(legacy.cpuStateCalls).toBeGreaterThan(0);
    expect(legacy.operationTrace[0]).toBe("start-1");
    // second read must not start before first read finishes/fails
    expect(legacy.operationTrace.indexOf("start-2")).toBeGreaterThan(legacy.operationTrace.indexOf("fail-1"));
    await client.disconnect();
  });
});
