import { createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { base58 } from "@scure/base";

export interface Keys {
  /** AES-256-GCM key for one kat's context. */
  katKey(tokenId: string): Buffer;
  /** HMAC key for session tokens. */
  sessionKey(): Buffer;
  /** The keeper's NEAR signing key, as `ed25519:<base58>`. */
  nearPrivateKey(): `ed25519:${string}`;
  nearPublicKey(): string;
}

// DER prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows it.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function derive(root: Uint8Array, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), info, 32));
}

export function keysFromRootSecret(root: Uint8Array): Keys {
  if (root.length !== 32) {
    throw new Error("Root secret must be 32 bytes");
  }
  const seed = derive(root, "nearkat/near-key");
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  const publicBytes = Buffer.from(jwk.x as string, "base64url");

  return {
    katKey: (tokenId) => derive(root, `nearkat/kat/${tokenId}`),
    sessionKey: () => derive(root, "nearkat/session"),
    nearPrivateKey: () => `ed25519:${base58.encode(Buffer.concat([seed, publicBytes]))}`,
    nearPublicKey: () => `ed25519:${base58.encode(publicBytes)}`,
  };
}

/** Reads the local-mode root secret: 64 hex characters. */
export function localRootSecret(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("KEEPER_ROOT_SECRET must be 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}
