import { describe, expect, it } from "vitest";

import { AsyncClient, type LegacyClientLike, type S7CommPlusClientLike } from "../src/client/async/async-client.js";
import { Block } from "../src/types.js";

class FakeLegacyWithBlocks implements LegacyClientLike {
  public connected = false;

  public connect(_options: { address: string; rack?: number; slot?: number; tcpPort?: number }): Promise<void> {
    void _options;
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

  public listBlocks(): Promise<{
    OBCount: number;
    FBCount: number;
    FCCount: number;
    SFBCount: number;
    SFCCount: number;
    DBCount: number;
    SDBCount: number;
  }> {
    return Promise.resolve({
      OBCount: 1,
      FBCount: 2,
      FCCount: 3,
      SFBCount: 4,
      SFCCount: 5,
      DBCount: 6,
      SDBCount: 7
    });
  }

  public listBlocksOfType(_blockType: Block, _maxCount: number): Promise<number[]> {
    void _blockType;
    void _maxCount;
    return Promise.resolve([1, 2, 3]);
  }

  public getBlockInfo(_blockType: Block, _blockNumber: number): Promise<{
    BlkType: number;
    BlkNumber: number;
    BlkLang: number;
    BlkFlags: number;
    MC7Size: number;
    LoadSize: number;
    LocalData: number;
    SBBLength: number;
    CheckSum: number;
    Version: number;
    CodeDate: string;
    IntfDate: string;
    Author: string;
    Family: string;
    Header: string;
  }> {
    void _blockType;
    void _blockNumber;
    return Promise.resolve({
      BlkType: 0x41,
      BlkNumber: 10,
      BlkLang: 1,
      BlkFlags: 0,
      MC7Size: 512,
      LoadSize: 1024,
      LocalData: 12,
      SBBLength: 3,
      CheckSum: 0x1234,
      Version: 1,
      CodeDate: "2024/01/01",
      IntfDate: "2024/01/02",
      Author: "AUTHOR",
      Family: "FAMILY",
      Header: "HEADER"
    });
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
    return Promise.resolve(new Uint8Array(0));
  }

  public dbWrite(): Promise<void> {
    return Promise.resolve();
  }

  public dbReadMulti(): Promise<Uint8Array[]> {
    return Promise.resolve([]);
  }
}

describe("AsyncClient block catalog/info APIs", () => {
  it("routes block APIs to legacy client in legacy mode", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new FakeLegacyWithBlocks(),
      createS7CommPlusClient: () => new FakePlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await expect(client.listBlocks()).resolves.toMatchObject({ DBCount: 6, OBCount: 1 });
    await expect(client.listBlocksOfType(Block.DB, 5)).resolves.toEqual([1, 2, 3]);
    await expect(client.getBlockInfo(Block.DB, 10)).resolves.toMatchObject({ BlkType: 0x41, BlkNumber: 10 });
  });

  it("rejects block APIs in s7commplus mode", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new FakeLegacyWithBlocks(),
      createS7CommPlusClient: () => new FakePlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "s7commplus" });

    await expect(client.listBlocks()).rejects.toThrow(/legacy protocol/i);
    await expect(client.listBlocksOfType(Block.DB, 5)).rejects.toThrow(/legacy protocol/i);
    await expect(client.getBlockInfo(Block.DB, 1)).rejects.toThrow(/legacy protocol/i);
  });

  it("decodes pg block info from raw block bytes without connection", () => {
    const client = new AsyncClient({
      createLegacyClient: () => new FakeLegacyWithBlocks(),
      createS7CommPlusClient: () => new FakePlusClient()
    });
    const raw = new Uint8Array(36);
    raw[4] = 2;
    raw[5] = 0x41;
    new DataView(raw.buffer).setUint16(6, 23, false);
    new DataView(raw.buffer).setUint32(8, 1000, false);
    new DataView(raw.buffer).setUint32(12, 2000, false);
    new DataView(raw.buffer).setUint32(28, 3000, false);
    new DataView(raw.buffer).setUint16(32, 0xaaaa, false);
    raw[34] = 7;

    const info = client.getPgBlockInfo(raw);
    expect(info.BlkType).toBe(0x41);
    expect(info.BlkNumber).toBe(23);
    expect(info.MC7Size).toBe(1000);
    expect(info.CodeDate).toBe("2019/06/27");
  });
});
