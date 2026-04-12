import { describe, expect, it } from "vitest";

import {
  AsyncIsoTransport,
  AsyncClient,
  LegacyS7AsyncClient,
  S7CommPlusAsyncClient,
  S7CommPlusConnection,
  codecModuleStatus,
  legacyS7Status,
  s7CommPlusStatus,
  transportStatus
} from "../src/index.js";

describe("Task 1 API surface", () => {
  it("exports AsyncClient and module statuses", () => {
    expect(AsyncClient).toBeTypeOf("function");
    expect(AsyncIsoTransport).toBeTypeOf("function");
    expect(LegacyS7AsyncClient).toBeTypeOf("function");
    expect(S7CommPlusConnection).toBeTypeOf("function");
    expect(S7CommPlusAsyncClient).toBeTypeOf("function");
    expect(codecModuleStatus.ready).toBe(true);
    expect(transportStatus.ready).toBe(true);
    expect(legacyS7Status.ready).toBe(true);
    expect(s7CommPlusStatus.ready).toBe(true);
  });
});
