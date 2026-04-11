/**
 * Protocol selection used by the unified async client.
 *
 * - `auto`: attempt S7CommPlus first, then fallback to legacy S7.
 * - `legacy`: force classic S7 protocol.
 * - `s7commplus`: force S7CommPlus protocol.
 */
export type ProtocolSelection = "auto" | "legacy" | "s7commplus";

/**
 * Connection options accepted by `AsyncClient.connect`.
 * Defaults are intentionally aligned with python-snap7 behavior.
 */
export interface ConnectOptions {
  address: string;
  rack?: number;
  slot?: number;
  tcpPort?: number;
  protocol?: ProtocolSelection;
}

/**
 * A single DB read segment used in multi-read operations.
 */
export interface DbReadItem {
  dbNumber: number;
  start: number;
  size: number;
}
