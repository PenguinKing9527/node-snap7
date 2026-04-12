import {
  DataType,
  Ids,
  decodePvalueToBytes,
  decodeUint32Vlq,
  decodeUint64Vlq,
  encodeItemAddress,
  encodeObjectQualifier,
  encodePvalueBlob,
  encodeUint32,
  encodeUint32Vlq
} from "../../core/index.js";

/**
 * Builds S7CommPlus GetMultiVariables payload for DB reads.
 */
export function buildReadPayload(items: Array<readonly [number, number, number]>): Uint8Array {
  const addresses: Uint8Array[] = [];
  let totalFieldCount = 0;

  for (const [dbNumber, start, size] of items) {
    const accessArea = Ids.DB_ACCESS_AREA_BASE + (dbNumber & 0xffff);
    const [address, fieldCount] = encodeItemAddress(accessArea, Ids.DB_VALUE_ACTUAL, [start + 1, size]);
    addresses.push(address);
    totalFieldCount += fieldCount;
  }

  const parts: Uint8Array[] = [];
  parts.push(encodeUint32(0));
  parts.push(encodeUint32Vlq(items.length));
  parts.push(encodeUint32Vlq(totalFieldCount));
  parts.push(...addresses);
  parts.push(encodeObjectQualifier());
  parts.push(encodeUint32(0));

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Builds S7CommPlus SetMultiVariables payload for DB writes.
 */
export function buildWritePayload(items: Array<readonly [number, number, Uint8Array]>): Uint8Array {
  const addresses: Uint8Array[] = [];
  let totalFieldCount = 0;

  for (const [dbNumber, start, data] of items) {
    const accessArea = Ids.DB_ACCESS_AREA_BASE + (dbNumber & 0xffff);
    const [address, fieldCount] = encodeItemAddress(accessArea, Ids.DB_VALUE_ACTUAL, [start + 1, data.length]);
    addresses.push(address);
    totalFieldCount += fieldCount;
  }

  const parts: Uint8Array[] = [];
  parts.push(encodeUint32(0));
  parts.push(encodeUint32Vlq(items.length));
  parts.push(encodeUint32Vlq(totalFieldCount));
  parts.push(...addresses);
  items.forEach((item, idx) => {
    const data = item[2];
    parts.push(encodeUint32Vlq(idx + 1));
    parts.push(encodePvalueBlob(data));
  });
  parts.push(Uint8Array.of(0x00));
  parts.push(encodeObjectQualifier());
  parts.push(encodeUint32(0));

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Parses GetMultiVariables response payload into item-aligned results.
 * Failed items are returned as `null`.
 */
export function parseReadResponse(response: Uint8Array): Array<Uint8Array | null> {
  let offset = 0;
  const [returnValue, rvConsumed] = decodeUint64Vlq(response, offset);
  offset += rvConsumed;
  if (returnValue !== 0n) {
    throw new Error(`Read failed with return value ${returnValue.toString()}`);
  }

  const values = new Map<number, Uint8Array>();
  while (offset < response.length) {
    const [itemNr, itemConsumed] = decodeUint32Vlq(response, offset);
    offset += itemConsumed;
    if (itemNr === 0) {
      break;
    }
    const [raw, rawConsumed] = decodePvalueToBytes(response, offset);
    offset += rawConsumed;
    values.set(itemNr, raw);
  }

  const errors = new Map<number, bigint>();
  while (offset < response.length) {
    const [itemNr, itemConsumed] = decodeUint32Vlq(response, offset);
    offset += itemConsumed;
    if (itemNr === 0) {
      break;
    }
    const [err, errConsumed] = decodeUint64Vlq(response, offset);
    offset += errConsumed;
    errors.set(itemNr, err);
  }

  const maxItem = Math.max(0, ...values.keys(), ...errors.keys());
  const results: Array<Uint8Array | null> = [];
  for (let i = 1; i <= maxItem; i += 1) {
    if (values.has(i)) {
      results.push(values.get(i)!);
    } else {
      results.push(null);
    }
  }
  return results;
}

/**
 * Parses SetMultiVariables response payload and throws on any write error.
 */
export function parseWriteResponse(response: Uint8Array): void {
  let offset = 0;
  const [returnValue, rvConsumed] = decodeUint64Vlq(response, offset);
  offset += rvConsumed;
  if (returnValue !== 0n) {
    throw new Error(`Write failed with return value ${returnValue.toString()}`);
  }

  const errors: Array<readonly [number, bigint]> = [];
  while (offset < response.length) {
    const [itemNr, itemConsumed] = decodeUint32Vlq(response, offset);
    offset += itemConsumed;
    if (itemNr === 0) {
      break;
    }
    const [errValue, errConsumed] = decodeUint64Vlq(response, offset);
    offset += errConsumed;
    errors.push([itemNr, errValue] as const);
  }
  if (errors.length > 0) {
    const detail = errors.map(([item, err]) => `item ${item}: error ${err.toString()}`).join(", ");
    throw new Error(`Write failed: ${detail}`);
  }
}

/**
 * Encodes CreateObject minimal session payload.
 */
export function buildCreateSessionPayload(): Uint8Array {
  const out: number[] = [];
  out.push(...Array.from(encodeUint32(285))); // RequestId = ObjectServerSessionContainer
  out.push(0x00, DataType.UDINT, 0x00); // ValueUDInt(0)
  out.push(...Array.from(encodeUint32(0))); // Unknown/padding
  // Minimal object body accepted by many V1 targets:
  // StartObject + GetNewRIDOnServer + ClassServerSession + flags + attribute + EndObject
  out.push(0xa1);
  out.push(...Array.from(encodeUint32(211)));
  out.push(...Array.from(encodeUint32Vlq(287)));
  out.push(...Array.from(encodeUint32Vlq(0)));
  out.push(...Array.from(encodeUint32Vlq(0)));
  out.push(0xa2);
  out.push(...Array.from(encodeUint32(0)));
  return Uint8Array.from(out);
}
