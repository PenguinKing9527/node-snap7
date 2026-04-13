/**
 * Readiness marker for the S7CommPlus subsystem.
 */
export interface S7CommPlusStatus {
  ready: boolean;
  note: string;
}

/**
 * S7CommPlus status, updated when Task 5 is completed.
 */
export const s7CommPlusStatus: S7CommPlusStatus = {
  ready: true,
  note: "S7CommPlus V1 async minimal DB read/write path is implemented in Task 5."
};

export { S7CommPlusConnection } from "./connection.js";
export { S7CommPlusAsyncClient } from "./s7commplus-async-client.js";
export { buildLegitimationPayload, buildLegacyResponse, buildNewResponse, deriveLegitimationKey } from "./legitimation.js";
export { buildCreateSessionPayload, buildReadPayload, buildWritePayload, parseReadResponse, parseWriteResponse } from "./payload.js";
export type { PlusTransport } from "./connection.js";
export type { S7CommPlusConnectionLike } from "./s7commplus-async-client.js";
