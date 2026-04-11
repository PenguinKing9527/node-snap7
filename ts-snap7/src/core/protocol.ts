/**
 * S7CommPlus frame protocol identifier.
 * Legacy S7comm uses 0x32, while S7CommPlus uses 0x72.
 */
export const PROTOCOL_ID = 0x72;

/**
 * Opcode values found in the first byte of S7CommPlus request/response headers.
 */
export enum Opcode {
  REQUEST = 0x31,
  RESPONSE = 0x32,
  NOTIFICATION = 0x33,
  RESPONSE2 = 0x02
}

/**
 * Wire-level datatype tags used in typed values (TLV-like encoding).
 *
 * These values follow python-snap7 `s7.protocol.DataType` and the
 * reverse-engineered S7CommPlus protocol conventions.
 */
export enum DataType {
  NULL = 0x00,
  BOOL = 0x01,
  USINT = 0x02,
  UINT = 0x03,
  UDINT = 0x04,
  ULINT = 0x05,
  SINT = 0x06,
  INT = 0x07,
  DINT = 0x08,
  LINT = 0x09,
  BYTE = 0x0a,
  WORD = 0x0b,
  DWORD = 0x0c,
  LWORD = 0x0d,
  REAL = 0x0e,
  LREAL = 0x0f,
  TIMESTAMP = 0x10,
  TIMESPAN = 0x11,
  RID = 0x12,
  AID = 0x13,
  BLOB = 0x14,
  WSTRING = 0x15,
  VARIANT = 0x16,
  STRUCT = 0x17,
  S7STRING = 0x19
}
