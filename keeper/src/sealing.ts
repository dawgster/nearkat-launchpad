import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomBytes,
} from "node:crypto";

/**
 * Sealed prompts: a creator encrypts secret instructions to the keeper's
 * X25519 sealing key, which is derived inside the TEE app and proven in its
 * quote. Format, base64: ephemeral public key (32) | nonce (12) | AES-256-GCM
 * ciphertext | tag (16). The AES key is HKDF-SHA256 over the shared secret,
 * salted with both public keys. The web app's `sealPrompt` must match this.
 */
const INFO = "nearkat-sealed-prompt:v1";
/** For an owner's chat history, sealed in their browser for one token's mind. */
export const IMPORT_INFO = "nearkat-history-import:v1";
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

const publicKeyObject = (raw: Uint8Array): KeyObject =>
  createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });

const rawPublic = (key: KeyObject): Buffer =>
  Buffer.from(key.export({ format: "jwk" }).x as string, "base64url");

function aesKey(
  shared: Buffer,
  ephemeral: Uint8Array,
  recipient: Uint8Array,
  info: string,
): Buffer {
  const salt = Buffer.concat([ephemeral, recipient]);
  return Buffer.from(hkdfSync("sha256", shared, salt, info, 32));
}

export interface SealingKey {
  /** The X25519 public key, hex, that creators encrypt to. */
  publicKeyHex: string;
  /**
   * Decrypts something sealed to this key for `info`'s purpose (a sealed
   * prompt by default). Throws if it was sealed to another key or purpose, or changed.
   */
  open(sealedBase64: string, info?: string): string;
}

/** The sealing key for a 32-byte seed. */
export function sealingKey(seed: Uint8Array): SealingKey {
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicRaw = rawPublic(createPublicKey(privateKey));
  return {
    publicKeyHex: publicRaw.toString("hex"),
    open(sealedBase64, info = INFO) {
      const sealed = Buffer.from(sealedBase64, "base64");
      if (sealed.length < 32 + 12 + 16) {
        throw new Error("The sealed prompt is too short");
      }
      const ephemeral = sealed.subarray(0, 32);
      const nonce = sealed.subarray(32, 44);
      const shared = diffieHellman({ privateKey, publicKey: publicKeyObject(ephemeral) });
      const decipher = createDecipheriv(
        "aes-256-gcm",
        aesKey(shared, ephemeral, publicRaw, info),
        nonce,
      );
      decipher.setAAD(Buffer.from(info));
      decipher.setAuthTag(sealed.subarray(sealed.length - 16));
      return Buffer.concat([
        decipher.update(sealed.subarray(44, sealed.length - 16)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

/** Encrypts to a sealing key. The web app does this in the creator's browser. */
export function sealTo(publicKeyHex: string, plaintext: string, info = INFO): string {
  const recipient = Buffer.from(publicKeyHex, "hex");
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const ephemeral = rawPublic(publicKey);
  const shared = diffieHellman({ privateKey, publicKey: publicKeyObject(recipient) });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(shared, ephemeral, recipient, info), nonce);
  cipher.setAAD(Buffer.from(info));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([ephemeral, nonce, body, cipher.getAuthTag()]).toString("base64");
}
