/**
 * Public package entrypoint.
 *
 * Export order keeps high-level client/types first, then low-level protocol
 * utilities so users can choose ergonomic API or protocol-level control.
 */
export { AsyncClient } from "./client/async/async-client.js";
export { Area, Block, ClientParameter, ConnectionType, WordLen } from "./types.js";
export type {
  BlocksList,
  ConnectOptions,
  DbReadItem,
  MultiVarReadItem,
  MultiVarReadResult,
  MultiVarWriteItem,
  ProtocolSelection,
  S7CpInfo,
  S7CpuInfo,
  S7OrderCode,
  S7Protection,
  S7SZL,
  S7SZLHeader,
  TS7BlockInfo
} from "./types.js";

export {
  Snap7ConnectionError,
  Snap7Error,
  Snap7NotImplementedError,
  Snap7ProtocolError
} from "./errors/index.js";

export {
  codecModuleStatus,
  DataType,
  ElementID,
  FunctionCode,
  Ids,
  ObjectId,
  S7COMMPLUS_LOCAL_TSAP,
  S7COMMPLUS_REMOTE_TSAP,
  decodeAidFromTypedValue,
  decodePvalueToBytes,
  decodeFloat32,
  decodeFloat64,
  decodeHeader,
  decodeInt16,
  decodeInt32,
  decodeInt32Vlq,
  decodeInt64,
  decodeInt64Vlq,
  decodeResponseHeader,
  decodeUint16,
  decodeUint32,
  decodeUint32Vlq,
  decodeUint64,
  decodeUint64Vlq,
  decodeUint8,
  Opcode,
  PROTOCOL_ID,
  decodeWString,
  encodeFloat32,
  encodeFloat64,
  encodeHeader,
  encodeItemAddress,
  encodeInt16,
  encodeInt32,
  encodeInt32Vlq,
  encodeInt64,
  encodeInt64Vlq,
  encodeObjectQualifier,
  encodePvalueBlob,
  encodeRequestHeader,
  encodeTypedValue,
  encodeUint16,
  encodeUint32,
  encodeUint32Vlq,
  encodeUint64,
  encodeUint64Vlq,
  encodeUint8,
  encodeWString
} from "./core/index.js";
export type { DecodedResponseHeader } from "./core/index.js";
export {
  AsyncIsoTransport,
  COTP_CC,
  COTP_CR,
  TPKT_VERSION,
  decodeCotpConnectionConfirm,
  decodeTpktHeader,
  encodeCotpConnectionRequest,
  encodeTpkt,
  transportStatus
} from "./transport/index.js";
export type { SocketFactory, SocketLike, TransportConnectOptions, TransportRequestOptions, TransportState } from "./transport/index.js";
export {
  LegacyS7AsyncClient,
  LegacyS7Protocol,
  getReturnCodeDescription,
  S7Area,
  S7BlockSubfunction,
  S7Function,
  S7PduType,
  S7_RETURN_CODES,
  S7WordLen,
  legacyS7Status
} from "./s7/legacy/index.js";
export type { LegacyS7Response, LegacyTransport } from "./s7/legacy/index.js";
export {
  S7CommPlusAsyncClient,
  S7CommPlusConnection,
  buildLegitimationPayload,
  buildLegacyResponse,
  buildNewResponse,
  buildCreateSessionPayload,
  buildReadPayload,
  buildWritePayload,
  deriveLegitimationKey,
  parseReadResponse,
  parseWriteResponse,
  s7CommPlusStatus
} from "./s7/plus/index.js";
export type { PlusTransport } from "./s7/plus/index.js";
export type { S7CommPlusConnectionLike } from "./s7/plus/index.js";
