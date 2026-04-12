/**
 * S7CommPlus wire codec helpers.
 *
 * This module mirrors the python-snap7 `s7.codec` responsibilities:
 * - frame/request/response headers
 * - fixed-width primitive encoding/decoding (big-endian)
 * - UTF-8 WString handling
 * - typed value serialization for key DataType branches
 */
import { DataType, Opcode, PROTOCOL_ID } from "./protocol.js";
import {
  decodeInt32Vlq,
  decodeInt64Vlq,
  decodeUint32Vlq,
  decodeUint64Vlq,
  encodeInt32Vlq,
  encodeInt64Vlq,
  encodeUint32Vlq,
  encodeUint64Vlq
} from "./vlq.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

const concat = (...chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

const writeU16 = (value: number): Uint8Array => {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, false);
  return out;
};

const writeU32 = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
};

const writeU64 = (value: bigint): Uint8Array => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, false);
  return out;
};

const writeI16 = (value: number): Uint8Array => {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setInt16(0, value, false);
  return out;
};

const writeI32 = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value, false);
  return out;
};

const writeI64 = (value: bigint): Uint8Array => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, value, false);
  return out;
};

const writeF32 = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setFloat32(0, value, false);
  return out;
};

const writeF64 = (value: number): Uint8Array => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return out;
};

const asUint8 = (value: number): Uint8Array => Uint8Array.of(value & 0xff);
const asBigInt = (value: number | bigint): bigint => (typeof value === "bigint" ? value : BigInt(value));

export interface DecodedResponseHeader {
  opcode: number;
  functionCode: number;
  sequenceNumber: number;
  sessionId: number;
  transportFlags: number;
  bytesConsumed: number;
}

/**
 * Encodes the 4-byte S7CommPlus frame header.
 */
export function encodeHeader(version: number, dataLength: number): Uint8Array {
  const out = new Uint8Array(4);
  const view = new DataView(out.buffer);
  view.setUint8(0, PROTOCOL_ID);
  view.setUint8(1, version);
  view.setUint16(2, dataLength, false);
  return out;
}

/**
 * Decodes frame header and validates protocol identifier.
 * Returns tuple `[version, payloadLength, bytesConsumed]`.
 */
export function decodeHeader(data: Uint8Array, offset = 0): readonly [number, number, number] {
  if (data.length - offset < 4) {
    throw new RangeError("Not enough data for S7CommPlus header");
  }
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  const protocolId = view.getUint8(0);
  if (protocolId !== PROTOCOL_ID) {
    throw new Error(`Invalid protocol ID: 0x${protocolId.toString(16).padStart(2, "0")}, expected 0x72`);
  }
  return [view.getUint8(1), view.getUint16(2, false), 4] as const;
}

/**
 * Encodes request header located after frame header.
 */
export function encodeRequestHeader(
  functionCode: number,
  sequenceNumber: number,
  sessionId = 0,
  transportFlags = 0x36
): Uint8Array {
  const out = new Uint8Array(14);
  const view = new DataView(out.buffer);
  view.setUint8(0, Opcode.REQUEST);
  view.setUint16(1, 0, false);
  view.setUint16(3, functionCode, false);
  view.setUint16(5, 0, false);
  view.setUint16(7, sequenceNumber, false);
  view.setUint32(9, sessionId, false);
  view.setUint8(13, transportFlags);
  return out;
}

/**
 * Decodes S7CommPlus response header fields.
 */
export function decodeResponseHeader(data: Uint8Array, offset = 0): DecodedResponseHeader {
  if (data.length - offset < 14) {
    throw new RangeError("Not enough data for S7CommPlus response header");
  }
  const view = new DataView(data.buffer, data.byteOffset + offset, 14);
  return {
    opcode: view.getUint8(0),
    functionCode: view.getUint16(3, false),
    sequenceNumber: view.getUint16(7, false),
    sessionId: view.getUint32(9, false),
    transportFlags: view.getUint8(13),
    bytesConsumed: 14
  };
}

/**
 * Encodes unsigned 8-bit integer.
 */
export function encodeUint8(value: number): Uint8Array {
  return asUint8(value);
}

/**
 * Decodes unsigned 8-bit integer.
 */
export function decodeUint8(data: Uint8Array, offset = 0): readonly [number, number] {
  return [new DataView(data.buffer, data.byteOffset + offset, 1).getUint8(0), 1] as const;
}

/**
 * Encodes unsigned 16-bit integer in big-endian order.
 */
export function encodeUint16(value: number): Uint8Array {
  return writeU16(value);
}

/**
 * Decodes unsigned 16-bit integer in big-endian order.
 */
export function decodeUint16(data: Uint8Array, offset = 0): readonly [number, number] {
  return [new DataView(data.buffer, data.byteOffset + offset, 2).getUint16(0, false), 2] as const;
}

/**
 * Encodes unsigned 32-bit integer in big-endian order.
 */
export function encodeUint32(value: number): Uint8Array {
  return writeU32(value);
}

/**
 * Decodes unsigned 32-bit integer in big-endian order.
 */
export function decodeUint32(data: Uint8Array, offset = 0): readonly [number, number] {
  return [new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false), 4] as const;
}

/**
 * Encodes unsigned 64-bit integer in big-endian order.
 */
export function encodeUint64(value: number | bigint): Uint8Array {
  return writeU64(asBigInt(value));
}

/**
 * Decodes unsigned 64-bit integer in big-endian order.
 */
export function decodeUint64(data: Uint8Array, offset = 0): readonly [bigint, number] {
  return [new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, false), 8] as const;
}

/**
 * Encodes signed 16-bit integer in big-endian order.
 */
export function encodeInt16(value: number): Uint8Array {
  return writeI16(value);
}

/**
 * Decodes signed 16-bit integer in big-endian order.
 */
export function decodeInt16(data: Uint8Array, offset = 0): readonly [number, number] {
  return [new DataView(data.buffer, data.byteOffset + offset, 2).getInt16(0, false), 2] as const;
}

/**
 * Encodes signed 32-bit integer in big-endian order.
 */
export function encodeInt32(value: number): Uint8Array {
  return writeI32(value);
}

/**
 * Decodes signed 32-bit integer in big-endian order.
 */
export function decodeInt32(data: Uint8Array, offset = 0): readonly [number, number] {
  return [new DataView(data.buffer, data.byteOffset + offset, 4).getInt32(0, false), 4] as const;
}

/**
 * Encodes signed 64-bit integer in big-endian order.
 */
export function encodeInt64(value: number | bigint): Uint8Array {
  return writeI64(asBigInt(value));
}

/**
 * Decodes signed 64-bit integer in big-endian order.
 */
export function decodeInt64(data: Uint8Array, offset = 0): readonly [bigint, number] {
  return [new DataView(data.buffer, data.byteOffset + offset, 8).getBigInt64(0, false), 8] as const;
}

/**
 * Encodes IEEE754 float32 in big-endian order.
 */
export function encodeFloat32(value: number): Uint8Array {
  return writeF32(value);
}

/**
 * Decodes IEEE754 float32 in big-endian order.
 */
export function decodeFloat32(data: Uint8Array, offset = 0): readonly [number, number] {
  return [new DataView(data.buffer, data.byteOffset + offset, 4).getFloat32(0, false), 4] as const;
}

/**
 * Encodes IEEE754 float64 in big-endian order.
 */
export function encodeFloat64(value: number): Uint8Array {
  return writeF64(value);
}

/**
 * Decodes IEEE754 float64 in big-endian order.
 */
export function decodeFloat64(data: Uint8Array, offset = 0): readonly [number, number] {
  return [new DataView(data.buffer, data.byteOffset + offset, 8).getFloat64(0, false), 8] as const;
}

/**
 * Encodes S7CommPlus WString payload bytes (UTF-8 in this protocol variant).
 */
export function encodeWString(value: string): Uint8Array {
  return encoder.encode(value);
}

/**
 * Decodes UTF-8 bytes into JavaScript string.
 */
export function decodeWString(data: Uint8Array, offset: number, length: number): readonly [string, number] {
  return [decoder.decode(data.subarray(offset, offset + length)), length] as const;
}

/**
 * Encodes a value prefixed by one-byte `DataType` tag.
 *
 * This is the common representation used inside S7CommPlus attribute payloads.
 */
export function encodeTypedValue(datatype: DataType, value: unknown): Uint8Array {
  const tag = Uint8Array.of(datatype);

  switch (datatype) {
    case DataType.NULL:
      return tag;
    case DataType.BOOL:
      return concat(tag, asUint8(value ? 1 : 0));
    case DataType.USINT:
    case DataType.BYTE:
      return concat(tag, asUint8(value as number));
    case DataType.UINT:
    case DataType.WORD:
      return concat(tag, writeU16(value as number));
    case DataType.UDINT:
    case DataType.DWORD:
      return concat(tag, encodeUint32Vlq(value as number));
    case DataType.ULINT:
    case DataType.LWORD:
      return concat(tag, encodeUint64Vlq(value as number | bigint));
    case DataType.SINT:
      return concat(tag, asUint8((value as number) & 0xff));
    case DataType.INT:
      return concat(tag, writeI16(value as number));
    case DataType.DINT:
      return concat(tag, encodeInt32Vlq(value as number));
    case DataType.LINT:
      return concat(tag, encodeInt64Vlq(value as number | bigint));
    case DataType.REAL:
      return concat(tag, writeF32(value as number));
    case DataType.LREAL:
      return concat(tag, writeF64(value as number));
    case DataType.TIMESTAMP:
      return concat(tag, writeU64(asBigInt(value as number | bigint)));
    case DataType.TIMESPAN:
      return concat(tag, encodeInt64Vlq(value as number | bigint));
    case DataType.RID:
      return concat(tag, writeU32(value as number));
    case DataType.AID:
      return concat(tag, encodeUint32Vlq(value as number));
    case DataType.WSTRING: {
      const encoded = encoder.encode(value as string);
      return concat(tag, encodeUint32Vlq(encoded.length), encoded);
    }
    case DataType.BLOB: {
      const blob = value instanceof Uint8Array ? value : Uint8Array.from(value as number[]);
      return concat(tag, encodeUint32Vlq(blob.length), blob);
    }
    default:
      throw new Error(`Unsupported DataType for encoding: 0x${datatype.toString(16).padStart(2, "0")}`);
  }
}

/**
 * Convenience helper to parse `AID` typed value from an arbitrary offset.
 */
export function decodeAidFromTypedValue(data: Uint8Array, offset = 0): readonly [number, number] {
  if (offset >= data.length || data[offset] !== DataType.AID) {
    throw new Error("Typed value at offset is not AID");
  }
  const [value, consumed] = decodeUint32Vlq(data, offset + 1);
  return [value, consumed + 1] as const;
}

/**
 * Encodes object qualifier structure used by S7CommPlus variable requests.
 */
export function encodeObjectQualifier(): Uint8Array {
  const parentRid = concat(
    encodeUint32Vlq(1257),
    Uint8Array.of(0x00, DataType.RID),
    encodeUint32(0)
  );
  const compositionAid = concat(
    encodeUint32Vlq(1258),
    Uint8Array.of(0x00, DataType.AID),
    encodeUint32Vlq(0)
  );
  const keyQualifier = concat(
    encodeUint32Vlq(1259),
    Uint8Array.of(0x00, DataType.UDINT),
    encodeUint32Vlq(0)
  );
  return concat(encodeUint32(1256), parentRid, compositionAid, keyQualifier, Uint8Array.of(0x00));
}

/**
 * Encodes ItemAddress for S7CommPlus multi-variable access.
 */
export function encodeItemAddress(
  accessArea: number,
  accessSubArea: number,
  lids: number[] = [],
  symbolCrc = 0
): readonly [Uint8Array, number] {
  const parts: Uint8Array[] = [];
  parts.push(encodeUint32Vlq(symbolCrc));
  parts.push(encodeUint32Vlq(accessArea));
  parts.push(encodeUint32Vlq(lids.length + 1));
  parts.push(encodeUint32Vlq(accessSubArea));
  for (const lid of lids) {
    parts.push(encodeUint32Vlq(lid));
  }
  return [concat(...parts), 4 + lids.length] as const;
}

/**
 * Encodes raw bytes as BLOB PValue.
 */
export function encodePvalueBlob(data: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0x00, DataType.BLOB), encodeUint32Vlq(data.length), data);
}

const pvalueElementSize = (datatype: DataType): number => {
  if (datatype === DataType.BOOL || datatype === DataType.USINT || datatype === DataType.BYTE || datatype === DataType.SINT) {
    return 1;
  }
  if (datatype === DataType.UINT || datatype === DataType.WORD || datatype === DataType.INT) {
    return 2;
  }
  if (datatype === DataType.REAL || datatype === DataType.RID) {
    return 4;
  }
  if (datatype === DataType.LREAL || datatype === DataType.TIMESTAMP) {
    return 8;
  }
  return 0;
};

/**
 * Decodes PValue to raw bytes.
 * Returns `[rawBytes, bytesConsumed]`.
 */
export function decodePvalueToBytes(data: Uint8Array, offset: number): readonly [Uint8Array, number] {
  if (offset + 2 > data.length) {
    throw new RangeError("Not enough data for PValue header");
  }

  const flags = data[offset]!;
  const datatype = data[offset + 1]! as DataType;
  let consumed = 2;
  const isArray = (flags & 0x10) !== 0;

  if (isArray) {
    const [count, countConsumed] = decodeUint32Vlq(data, offset + consumed);
    consumed += countConsumed;
    const elemSize = pvalueElementSize(datatype);
    if (elemSize > 0) {
      const total = count * elemSize;
      const raw = data.slice(offset + consumed, offset + consumed + total);
      consumed += total;
      return [raw, consumed] as const;
    }
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < count; i += 1) {
      const [val, c] = decodeUint32Vlq(data, offset + consumed);
      consumed += c;
      chunks.push(encodeUint32Vlq(val));
    }
    return [concat(...chunks), consumed] as const;
  }

  if (datatype === DataType.NULL) {
    return [new Uint8Array(0), consumed] as const;
  }
  if (datatype === DataType.BOOL || datatype === DataType.USINT || datatype === DataType.BYTE || datatype === DataType.SINT) {
    return [data.slice(offset + consumed, offset + consumed + 1), consumed + 1] as const;
  }
  if (datatype === DataType.UINT || datatype === DataType.WORD || datatype === DataType.INT) {
    return [data.slice(offset + consumed, offset + consumed + 2), consumed + 2] as const;
  }
  if (datatype === DataType.UDINT || datatype === DataType.DWORD) {
    const [val, c] = decodeUint32Vlq(data, offset + consumed);
    consumed += c;
    return [encodeUint32(val), consumed] as const;
  }
  if (datatype === DataType.DINT) {
    const [val, c] = decodeInt32Vlq(data, offset + consumed);
    consumed += c;
    return [encodeInt32(val), consumed] as const;
  }
  if (datatype === DataType.REAL) {
    return [data.slice(offset + consumed, offset + consumed + 4), consumed + 4] as const;
  }
  if (datatype === DataType.LREAL) {
    return [data.slice(offset + consumed, offset + consumed + 8), consumed + 8] as const;
  }
  if (datatype === DataType.ULINT || datatype === DataType.LWORD) {
    const [val, c] = decodeUint64Vlq(data, offset + consumed);
    consumed += c;
    return [encodeUint64(val), consumed] as const;
  }
  if (datatype === DataType.LINT || datatype === DataType.TIMESPAN) {
    const [val, c] = decodeInt64Vlq(data, offset + consumed);
    consumed += c;
    return [encodeInt64(val), consumed] as const;
  }
  if (datatype === DataType.TIMESTAMP) {
    return [data.slice(offset + consumed, offset + consumed + 8), consumed + 8] as const;
  }
  if (datatype === DataType.RID) {
    return [data.slice(offset + consumed, offset + consumed + 4), consumed + 4] as const;
  }
  if (datatype === DataType.AID) {
    const [val, c] = decodeUint32Vlq(data, offset + consumed);
    consumed += c;
    return [encodeUint32(val), consumed] as const;
  }
  if (datatype === DataType.BLOB || datatype === DataType.WSTRING) {
    const [len, c] = decodeUint32Vlq(data, offset + consumed);
    consumed += c;
    const raw = data.slice(offset + consumed, offset + consumed + len);
    consumed += len;
    return [raw, consumed] as const;
  }

  throw new Error(`Unsupported PValue datatype: 0x${datatype.toString(16).padStart(2, "0")}`);
}
