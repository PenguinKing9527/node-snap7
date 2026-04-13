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
 * S7 memory areas for generic area read/write.
 *
 * Values are aligned with classic S7 area identifiers.
 */
export enum Area {
  PE = 0x81,
  PA = 0x82,
  MK = 0x83,
  DB = 0x84,
  CT = 0x1c,
  TM = 0x1d
}

/**
 * S7 transport/word length identifiers.
 *
 * These values are used in S7 ANY address specifications.
 */
export enum WordLen {
  Bit = 0x01,
  Byte = 0x02,
  Char = 0x03,
  Word = 0x04,
  Int = 0x05,
  DWord = 0x06,
  DInt = 0x07,
  Real = 0x08,
  Counter = 0x1c,
  Timer = 0x1d
}

/**
 * Classic S7 block type identifiers used by block-catalog APIs.
 */
export enum Block {
  OB = 0x38,
  DB = 0x41,
  SDB = 0x42,
  FC = 0x43,
  SFC = 0x44,
  FB = 0x45,
  SFB = 0x46
}

/**
 * Block-count summary returned by `listBlocks`.
 */
export interface BlocksList {
  OBCount: number;
  FBCount: number;
  FCCount: number;
  SFBCount: number;
  SFCCount: number;
  DBCount: number;
  SDBCount: number;
}

/**
 * Block metadata compatible with python-snap7 `TS7BlockInfo`.
 *
 * String fields are plain JS strings in this TypeScript port.
 */
export interface TS7BlockInfo {
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
}

/**
 * CPU identification fields compatible with python-snap7 `S7CpuInfo`.
 */
export interface S7CpuInfo {
  ModuleTypeName: string;
  SerialNumber: string;
  ASName: string;
  Copyright: string;
  ModuleName: string;
}

/**
 * Communication processor capability fields from SZL 0x0131.
 */
export interface S7CpInfo {
  MaxPduLength: number;
  MaxConnections: number;
  MaxMpiRate: number;
  MaxBusRate: number;
}

/**
 * Order code and firmware version tuple from SZL 0x0011.
 */
export interface S7OrderCode {
  OrderCode: string;
  V1: number;
  V2: number;
  V3: number;
}

/**
 * PLC protection levels from SZL 0x0232.
 */
export interface S7Protection {
  sch_schal: number;
  sch_par: number;
  sch_rel: number;
  bart_sch: number;
  anl_sch: number;
}

/**
 * Header metadata for SZL payloads.
 */
export interface S7SZLHeader {
  LengthDR: number;
  NDR: number;
}

/**
 * System Status List payload returned by `readSzl`.
 */
export interface S7SZL {
  Header: S7SZLHeader;
  Data: Uint8Array;
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
  useTls?: boolean;
  tlsCert?: string;
  tlsKey?: string;
  tlsCa?: string;
  use_tls?: boolean;
  tls_cert?: string;
  tls_key?: string;
  tls_ca?: string;
}

/**
 * A single DB read segment used in multi-read operations.
 */
export interface DbReadItem {
  dbNumber: number;
  start: number;
  size: number;
}

/**
 * Input item for multi-variable read operations.
 */
export interface MultiVarReadItem {
  area: Area;
  dbNumber?: number;
  start: number;
  size: number;
  wordLen?: WordLen;
}

/**
 * Input item for multi-variable write operations.
 */
export interface MultiVarWriteItem {
  area: Area;
  dbNumber?: number;
  start: number;
  data: Uint8Array;
  wordLen?: WordLen;
}

/**
 * Result for multi-variable read operations.
 *
 * `result` follows python-snap7 style where 0 represents success.
 */
export interface MultiVarReadResult {
  result: number;
  items: Uint8Array[];
}
