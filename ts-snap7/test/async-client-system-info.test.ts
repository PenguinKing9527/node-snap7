import { describe, expect, it } from "vitest";

import { AsyncClient, type LegacyClientLike, type S7CommPlusClientLike } from "../src/client/async/async-client.js";
import { Block } from "../src/types.js";

class FakeLegacySystemClient implements LegacyClientLike {
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

  public plcStop(): Promise<number> {
    return Promise.resolve(0);
  }

  public plcHotStart(): Promise<number> {
    return Promise.resolve(0);
  }

  public plcColdStart(): Promise<number> {
    return Promise.resolve(0);
  }

  public getPlcDatetime(): Promise<Date> {
    return Promise.resolve(new Date(2026, 3, 13, 10, 20, 30));
  }

  public setPlcDatetime(): Promise<number> {
    return Promise.resolve(0);
  }

  public setPlcSystemDatetime(): Promise<number> {
    return Promise.resolve(0);
  }

  public getCpuState(): Promise<string> {
    return Promise.resolve("S7CpuStatusRun");
  }

  public readSzl(): Promise<{ Header: { LengthDR: number; NDR: number }; Data: Uint8Array }> {
    return Promise.resolve({
      Header: { LengthDR: 4, NDR: 1 },
      Data: Uint8Array.of(1, 2, 3, 4)
    });
  }

  public getCpuInfo(): Promise<{
    ModuleTypeName: string;
    SerialNumber: string;
    ASName: string;
    Copyright: string;
    ModuleName: string;
  }> {
    return Promise.resolve({
      ModuleTypeName: "CPU1511",
      SerialNumber: "SN001",
      ASName: "AS",
      Copyright: "SIEMENS",
      ModuleName: "MAIN"
    });
  }

  public getCpInfo(): Promise<{ MaxPduLength: number; MaxConnections: number; MaxMpiRate: number; MaxBusRate: number }> {
    return Promise.resolve({
      MaxPduLength: 960,
      MaxConnections: 8,
      MaxMpiRate: 187,
      MaxBusRate: 1500
    });
  }

  public getOrderCode(): Promise<{ OrderCode: string; V1: number; V2: number; V3: number }> {
    return Promise.resolve({
      OrderCode: "6ES7 151-1",
      V1: 1,
      V2: 2,
      V3: 3
    });
  }

  public getProtection(): Promise<{ sch_schal: number; sch_par: number; sch_rel: number; bart_sch: number; anl_sch: number }> {
    return Promise.resolve({
      sch_schal: 1,
      sch_par: 2,
      sch_rel: 3,
      bart_sch: 4,
      anl_sch: 5
    });
  }

  public isoExchangeBuffer(data: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(data);
  }

  public delete(): Promise<number> {
    return Promise.resolve(0);
  }

  public upload(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(0));
  }

  public fullUpload(): Promise<readonly [Uint8Array, number]> {
    return Promise.resolve([new Uint8Array(0), 0] as const);
  }

  public download(): Promise<number> {
    return Promise.resolve(0);
  }

  public listBlocks(): Promise<{ OBCount: number; FBCount: number; FCCount: number; SFBCount: number; SFCCount: number; DBCount: number; SDBCount: number }> {
    return Promise.resolve({ OBCount: 0, FBCount: 0, FCCount: 0, SFBCount: 0, SFCCount: 0, DBCount: 0, SDBCount: 0 });
  }

  public listBlocksOfType(_blockType: Block): Promise<number[]> {
    void _blockType;
    return Promise.resolve([]);
  }

  public getBlockInfo(): Promise<{
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
    return Promise.resolve({
      BlkType: 0,
      BlkNumber: 0,
      BlkLang: 0,
      BlkFlags: 0,
      MC7Size: 0,
      LoadSize: 0,
      LocalData: 0,
      SBBLength: 0,
      CheckSum: 0,
      Version: 0,
      CodeDate: "",
      IntfDate: "",
      Author: "",
      Family: "",
      Header: ""
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

describe("AsyncClient system/control APIs", () => {
  it("routes control/info APIs to legacy client", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new FakeLegacySystemClient(),
      createS7CommPlusClient: () => new FakePlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });

    await expect(client.plcStop()).resolves.toBe(0);
    await expect(client.plcHotStart()).resolves.toBe(0);
    await expect(client.plcColdStart()).resolves.toBe(0);
    await expect(client.getPlcDatetime()).resolves.toBeInstanceOf(Date);
    await expect(client.setPlcDatetime(new Date())).resolves.toBe(0);
    await expect(client.setPlcSystemDatetime()).resolves.toBe(0);
    await expect(client.getCpuState()).resolves.toBe("S7CpuStatusRun");
    await expect(client.readSzl(0x001c, 0)).resolves.toMatchObject({ Header: { LengthDR: 4 } });
    await expect(client.getCpuInfo()).resolves.toMatchObject({ ModuleTypeName: "CPU1511" });
    await expect(client.getCpInfo()).resolves.toMatchObject({ MaxPduLength: 960 });
    await expect(client.getOrderCode()).resolves.toMatchObject({ OrderCode: "6ES7 151-1" });
    await expect(client.getProtection()).resolves.toMatchObject({ sch_schal: 1 });
    await expect(client.isoExchangeBuffer(Uint8Array.of(1, 2, 3))).resolves.toEqual(Uint8Array.of(1, 2, 3));
  });

  it("rejects control/info APIs in s7commplus mode", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new FakeLegacySystemClient(),
      createS7CommPlusClient: () => new FakePlusClient()
    });
    await client.connect({ address: "127.0.0.1", protocol: "s7commplus" });

    await expect(client.plcStop()).rejects.toThrow(/legacy protocol/i);
    await expect(client.getPlcDatetime()).rejects.toThrow(/legacy protocol/i);
    await expect(client.readSzl(0x001c, 0)).rejects.toThrow(/legacy protocol/i);
    await expect(client.getCpuInfo()).rejects.toThrow(/legacy protocol/i);
    await expect(client.isoExchangeBuffer(Uint8Array.of(1))).rejects.toThrow(/legacy protocol/i);
  });
});
