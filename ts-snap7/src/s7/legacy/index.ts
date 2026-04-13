/**
 * Readiness marker for the legacy S7 subsystem.
 */
export interface LegacyS7Status {
  ready: boolean;
  note: string;
}

/**
 * Legacy S7 implementation status, updated when Task 4 is completed.
 */
export const legacyS7Status: LegacyS7Status = {
  ready: true,
  note: "Legacy S7 async minimal DB read/write path is implemented in Task 4."
};

export { LegacyS7AsyncClient } from "./legacy-async-client.js";
export { LegacyS7Protocol, S7Area, S7BlockSubfunction, S7Function, S7PduType, S7WordLen } from "./protocol.js";
export type { LegacyS7Response, ParsedGetBlockInfo, ParsedReadSzl } from "./protocol.js";
export type { LegacyTransport } from "./legacy-async-client.js";
