/**
 * Readiness flag for the core codec/VLQ subsystem.
 * This is mainly used by staged task tests to detect task completion.
 */
export interface CodecModuleStatus {
  ready: boolean;
  note: string;
}

/**
 * Current status of the codec layer implementation.
 */
export const codecModuleStatus: CodecModuleStatus = {
  ready: true,
  note: "Codec and VLQ primitives are implemented in Task 2."
};

export {
  DataType,
  ElementID,
  FunctionCode,
  Ids,
  LegitimationId,
  ObjectId,
  Opcode,
  PROTOCOL_ID,
  S7COMMPLUS_LOCAL_TSAP,
  S7COMMPLUS_REMOTE_TSAP
} from "./protocol.js";
export {
  decodeInt32Vlq,
  decodeInt64Vlq,
  decodeUint32Vlq,
  decodeUint64Vlq,
  encodeInt32Vlq,
  encodeInt64Vlq,
  encodeUint32Vlq,
  encodeUint64Vlq
} from "./vlq.js";
export {
  decodeAidFromTypedValue,
  decodePvalueToBytes,
  decodeFloat32,
  decodeFloat64,
  decodeHeader,
  decodeInt16,
  decodeInt32,
  decodeInt64,
  decodeResponseHeader,
  decodeUint16,
  decodeUint32,
  decodeUint64,
  decodeUint8,
  decodeWString,
  encodeFloat32,
  encodeFloat64,
  encodeHeader,
  encodeItemAddress,
  encodeInt16,
  encodeInt32,
  encodeInt64,
  encodeObjectQualifier,
  encodePvalueBlob,
  encodeRequestHeader,
  encodeTypedValue,
  encodeUint16,
  encodeUint32,
  encodeUint64,
  encodeUint8,
  encodeWString
} from "./codec.js";
export type { DecodedResponseHeader } from "./codec.js";
