/**
 * Public package entrypoint.
 *
 * Export order keeps high-level client/types first, then low-level protocol
 * utilities so users can choose ergonomic API or protocol-level control.
 */
export { AsyncClient } from "./client/async/async-client.js";
export type { ConnectOptions, DbReadItem, ProtocolSelection } from "./types.js";

export {
  Snap7ConnectionError,
  Snap7Error,
  Snap7NotImplementedError,
  Snap7ProtocolError
} from "./errors/index.js";

export {
  codecModuleStatus,
  DataType,
  decodeAidFromTypedValue,
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
  encodeInt16,
  encodeInt32,
  encodeInt32Vlq,
  encodeInt64,
  encodeInt64Vlq,
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
export { legacyS7Status } from "./s7/legacy/index.js";
export { s7CommPlusStatus } from "./s7/plus/index.js";
