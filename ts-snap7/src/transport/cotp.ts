/**
 * COTP connection helpers used by ISO-on-TCP session establishment.
 *
 * This file includes:
 * - Connection Request (CR) encoding
 * - Connection Confirm (CC) validation/parsing
 */

export const COTP_CR = 0xe0;
export const COTP_CC = 0xd0;

const COTP_PARAM_PDU_SIZE = 0xc0;
const COTP_PARAM_CALLING_TSAP = 0xc1;
const COTP_PARAM_CALLED_TSAP = 0xc2;

const DEFAULT_SRC_REF = 0x0001;
const DEFAULT_TPDU_SIZE_CODE = 0x0a; // 2^10 = 1024

const tsapToBytes = (tsap: number | Uint8Array): Uint8Array => {
  if (tsap instanceof Uint8Array) {
    return tsap;
  }
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, tsap, false);
  return out;
};

/**
 * Encodes COTP Connection Request payload.
 */
export function encodeCotpConnectionRequest(localTsap: number, remoteTsap: number | Uint8Array): Uint8Array {
  const localTsapBytes = tsapToBytes(localTsap);
  const remoteTsapBytes = tsapToBytes(remoteTsap);

  const params = new Uint8Array(
    2 + localTsapBytes.length + // C1 len + bytes
      2 +
      remoteTsapBytes.length + // C2 len + bytes
      3 // C0 len + size code
  );

  let p = 0;
  params[p++] = COTP_PARAM_CALLING_TSAP;
  params[p++] = localTsapBytes.length;
  params.set(localTsapBytes, p);
  p += localTsapBytes.length;

  params[p++] = COTP_PARAM_CALLED_TSAP;
  params[p++] = remoteTsapBytes.length;
  params.set(remoteTsapBytes, p);
  p += remoteTsapBytes.length;

  params[p++] = COTP_PARAM_PDU_SIZE;
  params[p++] = 0x01;
  params[p++] = DEFAULT_TPDU_SIZE_CODE;

  const headerLength = 6 + params.length; // length value excludes own byte
  const out = new Uint8Array(1 + headerLength);
  const view = new DataView(out.buffer);
  let i = 0;
  view.setUint8(i++, headerLength);
  view.setUint8(i++, COTP_CR);
  view.setUint16(i, 0x0000, false);
  i += 2;
  view.setUint16(i, DEFAULT_SRC_REF, false);
  i += 2;
  view.setUint8(i++, 0x00); // class/option
  out.set(params, i);
  return out;
}

/**
 * Minimal parsed information from COTP Connection Confirm.
 */
export interface CotpConnectionConfirm {
  destinationReference: number;
}

/**
 * Validates and decodes COTP Connection Confirm.
 */
export function decodeCotpConnectionConfirm(data: Uint8Array): CotpConnectionConfirm {
  if (data.length < 7) {
    throw new RangeError("Invalid COTP CC: too short");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const pduType = view.getUint8(1);
  if (pduType !== COTP_CC) {
    throw new Error(`Expected COTP CC, got 0x${pduType.toString(16).padStart(2, "0")}`);
  }

  return {
    destinationReference: view.getUint16(2, false)
  };
}
