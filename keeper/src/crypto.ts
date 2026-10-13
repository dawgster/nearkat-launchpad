import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const NONCE_LEN = 12;
const TAG_LEN = 16;

/** AES-256-GCM. Output layout: nonce (12) | ciphertext | tag (16). */
export function seal(key: Uint8Array, plaintext: Uint8Array): Buffer {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  return Buffer.concat([nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** Throws if the blob was not sealed with this key or was modified. */
export function open(key: Uint8Array, blob: Uint8Array): Buffer {
  if (blob.length < NONCE_LEN + TAG_LEN) {
    throw new Error("Sealed blob is too short");
  }
  const data = Buffer.from(blob);
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, NONCE_LEN));
  decipher.setAuthTag(data.subarray(data.length - TAG_LEN));
  return Buffer.concat([
    decipher.update(data.subarray(NONCE_LEN, data.length - TAG_LEN)),
    decipher.final(),
  ]);
}
