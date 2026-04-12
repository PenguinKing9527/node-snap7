import { describe, expect, it } from "vitest";

import { AsyncClient, type LegacyClientLike, type S7CommPlusClientLike } from "../src/client/async/async-client.js";
import { Snap7ConnectionError } from "../src/errors/index.js";
import { ClientParameter, ConnectionType } from "../src/types.js";

class ControlLegacyClient implements LegacyClientLike {
  public connected = false;
  public negotiatedPduLength = 960;

  public connect(_options: { address: string; rack?: number; slot?: number; tcpPort?: number }): Promise<void> {
    void _options;
    this.connected = true;
    return Promise.resolve();
  }

  public disconnect(): Promise<void> {
    this.connected = false;
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

class ControlPlusClient implements S7CommPlusClientLike {
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

describe("AsyncClient Task 9 controls and diagnostics", () => {
  it("supports connection metadata and session password APIs", () => {
    const client = new AsyncClient({
      createLegacyClient: () => new ControlLegacyClient(),
      createS7CommPlusClient: () => new ControlPlusClient()
    });

    client.setConnectionParams("192.168.0.10", 0x100, 0x102);
    client.setConnectionType(ConnectionType.OP);
    expect(client.setSessionPassword("pw")).toBe(0);
    expect(client.clearSessionPassword()).toBe(0);
  });

  it("supports getParam/setParam and enforces parameter guards", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new ControlLegacyClient(),
      createS7CommPlusClient: () => new ControlPlusClient()
    });

    expect(client.setParam(ClientParameter.PDURequest, 1024)).toBe(0);
    expect(client.getPduLength()).toBe(1024);
    expect(client.getParam(ClientParameter.PDURequest)).toBe(1024);
    expect(client.getParam(ClientParameter.SrcTSap)).toBe(0x0100);

    expect(() => client.getParam(ClientParameter.LocalPort)).toThrow(/not valid for client/i);

    await client.connect({ address: "127.0.0.1", protocol: "legacy" });
    expect(() => client.setParam(ClientParameter.RemotePort, 2000)).toThrow(/cannot change/i);
  });

  it("tracks connected state, pdu length, and execution diagnostics", async () => {
    const legacy = new ControlLegacyClient();
    const client = new AsyncClient({
      createLegacyClient: () => legacy,
      createS7CommPlusClient: () => new ControlPlusClient()
    });

    expect(client.connected).toBe(false);
    await client.connect({ address: "127.0.0.1", protocol: "legacy" });
    expect(client.connected).toBe(true);
    expect(client.getPduLength()).toBe(960);

    await client.dbRead(1, 0, 4);
    expect(client.getExecTime()).toBeGreaterThanOrEqual(0);
    expect(client.getLastError()).toBe(0);

    await client.disconnect();
    expect(client.connected).toBe(false);
  });

  it("sets not-connected error code when data APIs are called before connect", async () => {
    const client = new AsyncClient({
      createLegacyClient: () => new ControlLegacyClient(),
      createS7CommPlusClient: () => new ControlPlusClient()
    });

    await expect(client.dbRead(1, 0, 1)).rejects.toBeInstanceOf(Snap7ConnectionError);
    expect(client.getLastError()).toBe(0x0003);
    expect(client.errorText(client.getLastError())).toMatch(/Not connected/i);
  });

  it("returns fallback text for unknown error codes", () => {
    const client = new AsyncClient({
      createLegacyClient: () => new ControlLegacyClient(),
      createS7CommPlusClient: () => new ControlPlusClient()
    });
    expect(client.errorText(999999)).toBe("Unknown error: 999999");
  });
});
