/**
 * TPKT helpers (RFC 1006).
 *
 * TPKT frame:
 * - byte 0: version (always 3)
 * - byte 1: reserved (always 0)
 * - byte 2-3: total frame length including 4-byte header
 * - bytes 4..: payload (typically COTP PDU)
 */

export const TPKT_VERSION = 0x03;

/**
 * Encodes a raw payload into TPKT frame.
 */
export function encodeTpkt(payload: Uint8Array): Uint8Array {
  const length = payload.length + 4;
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint8(0, TPKT_VERSION);
  view.setUint8(1, 0x00);
  view.setUint16(2, length, false);
  out.set(payload, 4);
  return out;
}

/**
 * Parses only TPKT frame header from a byte buffer.
 * Returns `[version, totalLength]`.
 */
export function decodeTpktHeader(data: Uint8Array, offset = 0): readonly [number, number] {
  if (data.length - offset < 4) {
    throw new RangeError("Not enough data for TPKT header");
  }
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  return [view.getUint8(0), view.getUint16(2, false)] as const;
}
