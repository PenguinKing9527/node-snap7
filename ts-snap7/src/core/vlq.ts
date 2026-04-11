/**
 * Variable-Length Quantity (VLQ) primitives for S7CommPlus.
 *
 * Format summary:
 * - Each byte normally carries 7 payload bits + 1 continuation bit (MSB).
 * - Bytes are ordered from most-significant group to least-significant group.
 * - Signed variants use bit 6 of the first byte as sign marker.
 * - 64-bit variants support S7CommPlus special 9th-byte form.
 */
const UINT32_MAX = 0xffffffff;
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;
const UINT64_MAX = 0xffffffffffffffffn;
const INT64_MIN = -0x8000000000000000n;
const INT64_MAX = 0x7fffffffffffffffn;

const asByte = (value: number): number => value & 0xff;
const toBigInt = (value: number | bigint): bigint => (typeof value === "bigint" ? value : BigInt(value));

export function encodeUint32Vlq(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new RangeError(`Value out of range for uint32 VLQ: ${value}`);
  }

  let current = value >>> 0;
  const groups: number[] = [];
  // Build 7-bit groups from least-significant side, then prepend.
  do {
    groups.unshift(current & 0x7f);
    current = current >>> 7;
  } while (current > 0);

  // All bytes except the last set continuation bit.
  for (let i = 0; i < groups.length - 1; i += 1) {
    groups[i] = groups[i]! | 0x80;
  }
  return Uint8Array.from(groups);
}

/**
 * Decodes an unsigned 32-bit VLQ value.
 *
 * Returns tuple `[value, bytesConsumed]` so caller can continue parsing.
 */
export function decodeUint32Vlq(data: Uint8Array, offset = 0): readonly [number, number] {
  let value = 0;
  let consumed = 0;

  for (let i = 0; i < 5; i += 1) {
    const idx = offset + consumed;
    if (idx >= data.length) {
      throw new RangeError("Unexpected end of VLQ data");
    }
    const octet = data[idx]!;
    consumed += 1;
    // Use multiplication instead of bitwise shifts to avoid 32-bit signed overflow in JS.
    value = value * 128 + (octet & 0x7f);
    if ((octet & 0x80) === 0) {
      break;
    }
  }
  return [value, consumed] as const;
}

/**
 * Encodes a signed 32-bit integer to S7 VLQ format.
 */
export function encodeInt32Vlq(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
    throw new RangeError(`Value out of range for int32 VLQ: ${value}`);
  }

  let absV = value === INT32_MIN ? 0x80000000n : BigInt(Math.abs(value));
  const b = new Array<number>(5).fill(0);
  let current = BigInt(value);
  b[0] = Number(current & 0x7fn);
  let length = 1;

  for (let i = 1; i < 5; i += 1) {
    if (absV >= 0x40n) {
      length += 1;
      absV >>= 7n;
      // Arithmetic shift keeps sign extension semantics for negative values.
      current >>= 7n;
      b[i] = asByte(Number((current & 0x7fn) + 0x80n));
    } else {
      break;
    }
  }

  const out: number[] = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    out.push(b[i]!);
  }
  return Uint8Array.from(out);
}

/**
 * Decodes a signed 32-bit integer from S7 VLQ format.
 */
export function decodeInt32Vlq(data: Uint8Array, offset = 0): readonly [number, number] {
  let value = 0;
  let consumed = 0;

  for (let counter = 1; counter <= 5; counter += 1) {
    const idx = offset + consumed;
    if (idx >= data.length) {
      throw new RangeError("Unexpected end of VLQ data");
    }
    let octet = data[idx]!;
    consumed += 1;

    if (counter === 1 && (octet & 0x40) !== 0) {
      octet &= 0xbf;
      // Signed decode seeds with one's-complement-like base used in S7 logic.
      value = -64;
    } else {
      value *= 128;
    }

    value += octet & 0x7f;
    if ((octet & 0x80) === 0) {
      break;
    }
  }

  return [value, consumed] as const;
}

/**
 * Encodes an unsigned 64-bit value.
 * Supports S7's special 9-byte encoding path for large values.
 */
export function encodeUint64Vlq(value: number | bigint): Uint8Array {
  const v = toBigInt(value);
  if (v < 0n || v > UINT64_MAX) {
    throw new RangeError(`Value out of range for uint64 VLQ: ${String(value)}`);
  }

  // S7 64-bit special mode: values above 56 bits may consume a 9th byte.
  const special = v > 0x00ffffffffffffffn;
  const b = new Array<number>(9).fill(0);
  b[0] = Number(special ? (v & 0xffn) : (v & 0x7fn));

  let length = 1;
  let current = v;
  for (let i = 1; i < 9; i += 1) {
    if (current >= 0x80n) {
      length += 1;
      if (i === 1 && special) {
        // First reduction removes 8 bits in special mode.
        current >>= 8n;
      } else {
        current >>= 7n;
      }
      b[i] = asByte(Number((current & 0x7fn) + 0x80n));
    } else {
      break;
    }
  }

  if (special && length === 8) {
    length += 1;
    b[8] = 0x80;
  }

  const out: number[] = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    out.push(b[i]!);
  }
  return Uint8Array.from(out);
}

/**
 * Decodes an unsigned 64-bit value and reports consumed length.
 */
export function decodeUint64Vlq(data: Uint8Array, offset = 0): readonly [bigint, number] {
  let value = 0n;
  let consumed = 0;
  let cont = 0;

  for (let counter = 1; counter <= 8; counter += 1) {
    const idx = offset + consumed;
    if (idx >= data.length) {
      throw new RangeError("Unexpected end of VLQ data");
    }
    const octet = data[idx]!;
    consumed += 1;
    value = (value << 7n) | BigInt(octet & 0x7f);
    cont = octet & 0x80;
    if (cont === 0) {
      break;
    }
  }

  if (cont !== 0) {
    // Continuation after 8 groups indicates special 9th byte (full 8-bit payload).
    const idx = offset + consumed;
    if (idx >= data.length) {
      throw new RangeError("Unexpected end of VLQ data");
    }
    const octet = data[idx]!;
    consumed += 1;
    value = (value << 8n) | BigInt(octet);
  }

  return [value, consumed] as const;
}

/**
 * Encodes a signed 64-bit value.
 */
export function encodeInt64Vlq(value: number | bigint): Uint8Array {
  const v = toBigInt(value);
  if (v < INT64_MIN || v > INT64_MAX) {
    throw new RangeError(`Value out of range for int64 VLQ: ${String(value)}`);
  }

  let absV = v === INT64_MIN ? 0x8000000000000000n : (v < 0n ? -v : v);
  // Same threshold logic as uint64, but preserving signed arithmetic behavior.
  const special = absV > 0x007fffffffffffffn;
  const b = new Array<number>(9).fill(0);
  b[0] = Number(special ? (v & 0xffn) : (v & 0x7fn));

  let length = 1;
  let current = v;
  for (let i = 1; i < 9; i += 1) {
    if (absV >= 0x40n) {
      length += 1;
      if (i === 1 && special) {
        absV >>= 8n;
        current >>= 8n;
      } else {
        absV >>= 7n;
        current >>= 7n;
      }
      b[i] = asByte(Number((current & 0x7fn) + 0x80n));
    } else {
      break;
    }
  }

  if (special && length === 8) {
    length += 1;
    b[8] = current >= 0n ? 0x80 : 0xff;
  }

  const out: number[] = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    out.push(b[i]!);
  }
  return Uint8Array.from(out);
}

/**
 * Decodes a signed 64-bit value.
 */
export function decodeInt64Vlq(data: Uint8Array, offset = 0): readonly [bigint, number] {
  let value = 0n;
  let consumed = 0;
  let cont = 0;

  for (let counter = 1; counter <= 8; counter += 1) {
    const idx = offset + consumed;
    if (idx >= data.length) {
      throw new RangeError("Unexpected end of VLQ data");
    }
    let octet = data[idx]!;
    consumed += 1;

    if (counter === 1 && (octet & 0x40) !== 0) {
      octet &= 0xbf;
      value = -64n;
    } else {
      value <<= 7n;
    }

    cont = octet & 0x80;
    value += BigInt(octet & 0x7f);
    if (cont === 0) {
      break;
    }
  }

  if (cont !== 0) {
    const idx = offset + consumed;
    if (idx >= data.length) {
      throw new RangeError("Unexpected end of VLQ data");
    }
    const octet = data[idx]!;
    consumed += 1;
    value = (value << 8n) | BigInt(octet);
  }

  return [value, consumed] as const;
}
