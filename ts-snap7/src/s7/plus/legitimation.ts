import { createCipheriv, createHash } from "node:crypto";

import { DataType, encodeUint32Vlq } from "../../core/index.js";

/**
 * Derive the 32-byte legitimation key from TLS OMS exporter secret.
 *
 * This mirrors python-snap7:
 * - key = sha256(oms_secret)
 */
export function deriveLegitimationKey(omsSecret: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(omsSecret).digest());
}

/**
 * Build legacy legitimation response (SHA-1 XOR challenge).
 *
 * For legacy mode, password is hashed first and XORed with the first 20 bytes
 * of challenge payload.
 */
export function buildLegacyResponse(password: string, challenge: Uint8Array): Uint8Array {
  const passwordHash = createHash("sha1").update(Buffer.from(password, "utf8")).digest();
  const length = Math.min(20, challenge.length, passwordHash.length);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = passwordHash[i]! ^ challenge[i]!;
  }
  return out;
}

/**
 * Build new-style legitimation response using AES-256-CBC.
 *
 * The IV is the first 16 bytes of challenge data.
 */
export function buildNewResponse(
  password: string,
  challenge: Uint8Array,
  omsSecret: Uint8Array,
  username = ""
): Uint8Array {
  if (challenge.length < 16) {
    throw new Error(`Legitimation challenge must be at least 16 bytes, got ${challenge.length}`);
  }

  const key = deriveLegitimationKey(omsSecret);
  const iv = Buffer.from(challenge.slice(0, 16));
  const payload = Buffer.from(buildLegitimationPayload(password, username));

  const cipher = createCipheriv("aes-256-cbc", Buffer.from(key), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return new Uint8Array(encrypted);
}

/**
 * Build legitimation value-struct payload.
 *
 * Structure fields:
 * - legitimation type (1 = legacy style, 2 = username/password style)
 * - username blob
 * - password blob (raw password bytes for type 2; SHA-1 for type 1)
 */
export function buildLegitimationPayload(password: string, username = ""): Uint8Array {
  const legitimationType = username.length > 0 ? 2 : 1;
  const usernameData = Buffer.from(username, "utf8");
  const passwordData =
    legitimationType === 2
      ? Buffer.from(password, "utf8")
      : createHash("sha1").update(Buffer.from(password, "utf8")).digest();

  return concat(
    Uint8Array.of(0x00, DataType.STRUCT),
    encodeUint32Vlq(3),
    Uint8Array.of(0x00, DataType.UDINT),
    encodeUint32Vlq(legitimationType),
    Uint8Array.of(0x00, DataType.BLOB),
    encodeUint32Vlq(usernameData.length),
    new Uint8Array(usernameData),
    Uint8Array.of(0x00, DataType.BLOB),
    encodeUint32Vlq(passwordData.length),
    new Uint8Array(passwordData)
  );
}

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

