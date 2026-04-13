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

/**
 * S7CommPlus function codes used by request/response headers.
 */
export enum FunctionCode {
  CREATE_OBJECT = 0x04ca,
  SET_MULTI_VARIABLES = 0x0542,
  GET_MULTI_VARIABLES = 0x054c,
  SET_VARIABLE = 0x04f2,
  GET_VAR_SUBSTREAMED = 0x0586,
  EXPLORE = 0x04bb,
  INIT_SSL = 0x05b3
}

/**
 * S7CommPlus legitimation object identifiers.
 */
export enum LegitimationId {
  SERVER_SESSION_REQUEST = 303,
  SERVER_SESSION_RESPONSE = 304,
  LEGITIMATE = 1846
}

/**
 * S7CommPlus object model element identifiers.
 */
export enum ElementID {
  START_OF_OBJECT = 0xa1,
  TERMINATING_OBJECT = 0xa2,
  ATTRIBUTE = 0xa3
}

/**
 * Well-known object identifiers used during session setup.
 */
export enum ObjectId {
  GET_NEW_RID_ON_SERVER = 211,
  CLASS_SUBSCRIPTIONS = 255,
  OBJECT_SERVER_SESSION_CONTAINER = 285,
  CLASS_SERVER_SESSION = 287,
  OBJECT_NULL_SERVER_SESSION = 288,
  SERVER_SESSION_CLIENT_RID = 300
}

/**
 * Well-known IDs for variable access structures.
 */
export enum Ids {
  DB_VALUE_ACTUAL = 2550,
  OBJECT_QUALIFIER = 1256,
  PARENT_RID = 1257,
  COMPOSITION_AID = 1258,
  KEY_QUALIFIER = 1259,
  DB_ACCESS_AREA_BASE = 0x8a0e0000
}

/**
 * Default TSAP values for S7CommPlus connections.
 */
export const S7COMMPLUS_LOCAL_TSAP = 0x0600;
export const S7COMMPLUS_REMOTE_TSAP = new TextEncoder().encode("SIMATIC-ROOT-HMI");
