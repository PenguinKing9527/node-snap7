import { describe, expect, it } from "vitest";

import { AsyncClient, type LegacyClientLike, type S7CommPlusClientLike } from "../src/client/async/async-client.js";
import { Block } from "../src/types.js";

class FakeLegacyTransferClient implements LegacyClientLike {
  public connected = false;

  public connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  public dbRead(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(0));
  }

  public dbWrite(): Promise<void> {
    return Promise.resolve();
  }

  public upload(_blockNumber: number): Promise<Uint8Array> {
    void _blockNumber;
    return Promise.resolve(Uint8Array.of(1, 2, 3, 4));
  }

  public fullUpload(_blockType: Block, _blockNumber: number): Promise<readonly [Uint8Array, number]> {
    void _blockType;
    void _blockNumber;
    const data = Uint8Array.of(0x70, 0x41, 0x00, 0x01);
    return Promise.resolve([data, data.length] as const);
  }

  public download(_data: Uint8Array, _blockNumber?: number): Promise<number> {
    void _data;
    void _blockNumber;
    return Promise.resolve(0);
  }

  public delete(_blockType: Block, _blockNumber: number): Promise<number> {
    void _blockType;
    void _blockNumber;
    return Promise.resolve(0);
  }
}

class FakePlusOnlyClient implements S7CommPlusClientLike {
  public connected = false;

  public connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): void {
    this.connected = false;
  }

  public dbRead(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(0));
  }

  public dbWrite(): Promise<void> {
    return Promise.resolve();
  }

  public dbReadMulti(): Promise<Uint8Array[]> {
    return Promise.resolve([]);
  }
}

describe("AsyncClient transfer APIs", () => {
  it("routes upload/fullUpload/download/delete to legacy client", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new FakeLegacyTransferClient(),
      createS7CommPlusClient: () => new FakePlusOnlyClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await expect(client.upload(1)).resolves.toEqual(Uint8Array.of(1, 2, 3, 4));
    await expect(client.fullUpload(Block.DB, 1)).resolves.toEqual([Uint8Array.of(0x70, 0x41, 0x00, 0x01), 4]);
    await expect(client.download(Uint8Array.of(1, 2, 3), 1)).resolves.toBe(0);
    await expect(client.delete(Block.DB, 1)).resolves.toBe(0);
  });

  it("rejects transfer APIs in s7commplus mode", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new FakeLegacyTransferClient(),
      createS7CommPlusClient: () => new FakePlusOnlyClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "s7commplus" });

    await expect(client.upload(1)).rejects.toThrow(/legacy protocol/i);
    await expect(client.fullUpload(Block.DB, 1)).rejects.toThrow(/legacy protocol/i);
    await expect(client.download(Uint8Array.of(1), 1)).rejects.toThrow(/legacy protocol/i);
    await expect(client.delete(Block.DB, 1)).rejects.toThrow(/legacy protocol/i);
  });
});
