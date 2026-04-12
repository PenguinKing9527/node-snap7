/**
 * Protocol selection used by the unified async client.
 *
 * - `auto`: attempt S7CommPlus first, then fallback to legacy S7.
 * - `legacy`: force classic S7 protocol.
 * - `s7commplus`: force S7CommPlus protocol.
 */
export type ProtocolSelection = "auto" | "legacy" | "s7commplus";

/**
 * Client connection profile type.
 *
 * Values align with python-snap7 semantics:
 * - `PG`: programming device
 * - `OP`: operator panel
 * - `S7_BASIC`: basic S7 connection profile
 */
export enum ConnectionType {
  PG = 1,
  OP = 2,
  S7_BASIC = 3
}

/**
 * Numeric client parameter identifiers compatible with python-snap7.
 */
export enum ClientParameter {
  LocalPort = 1,
  RemotePort = 2,
  PingTimeout = 3,
  SendTimeout = 4,
  RecvTimeout = 5,
  WorkInterval = 6,
  SrcRef = 7,
  DstRef = 8,
  SrcTSap = 9,
  PDURequest = 10,
  MaxClients = 11,
  BSendTimeout = 12,
  BRecvTimeout = 13,
  RecoveryTime = 14,
  KeepAliveTime = 15
}

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
