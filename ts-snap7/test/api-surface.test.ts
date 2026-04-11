import { describe, expect, it } from "vitest";

import {
  AsyncIsoTransport,
  AsyncClient,
  Snap7NotImplementedError,
  codecModuleStatus,
  legacyS7Status,
  s7CommPlusStatus,
  transportStatus
} from "../src/index.js";

describe("Task 1 API surface", () => {
  it("exports AsyncClient and module statuses", () => {
    expect(AsyncClient).toBeTypeOf("function");
    expect(AsyncIsoTransport).toBeTypeOf("function");
    expect(codecModuleStatus.ready).toBe(true);
    expect(transportStatus.ready).toBe(true);
    expect(legacyS7Status.ready).toBe(false);
    expect(s7CommPlusStatus.ready).toBe(false);
  });

  it("connect rejects with NotImplemented while preserving protocol selection", async () => {
    const client = new AsyncClient();

    await expect(
      client.connect({
        address: "127.0.0.1",
        protocol: "legacy"
      })
    ).rejects.toBeInstanceOf(Snap7NotImplementedError);

    expect(client.protocol).toBe("legacy");
  });

  it("db methods reject with NotImplemented", async () => {
    const client = new AsyncClient();

    await expect(client.dbRead(1, 0, 4)).rejects.toBeInstanceOf(Snap7NotImplementedError);
    await expect(client.dbWrite(1, 0, new Uint8Array([1, 2]))).rejects.toBeInstanceOf(Snap7NotImplementedError);
    await expect(client.dbReadMulti([{ dbNumber: 1, start: 0, size: 2 }])).rejects.toBeInstanceOf(
      Snap7NotImplementedError
    );
  });
});
