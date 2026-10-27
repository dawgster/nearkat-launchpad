import { createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { base58 } from "@scure/base";
import { type SealingKey, sealingKey } from "./sealing.ts";

export interface Keys {
  /** AES-256-GCM key for one kat's context. */
  katKey(tokenId: string): Buffer;
  /**
   * The same keys, with kat keys scoped to one collection contract, so a
   * keeper serving many collections never reuses a key across them.
   */
  forContract(contractId: string): Keys;
  /**
   * The same keys, with kat keys derived from a collection's context root
   * (its key from NEAR's MPC network) instead of the keeper's own secret.
   */
  withContextRoot(root: Uint8Array): Keys;
  /** HMAC key for session tokens. */
  sessionKey(): Buffer;
  /** The keeper's NEAR signing key, as `ed25519:<base58>`. */
  nearPrivateKey(): `ed25519:${string}`;
  nearPublicKey(): string;
  /** The X25519 key creators seal secret prompts to. Same for every instance of the app. */
  sealing(): SealingKey;
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

  const sealing = sealingKey(derive(root, "nearkat/seal"));
  const keys = (katRoot: Uint8Array, katPrefix: string): Keys => ({
    sealing: () => sealing,
    katKey: (tokenId) => derive(katRoot, `${katPrefix}${tokenId}`),
    forContract: (contractId) => keys(root, `nearkat/kat/${contractId}/`),
    withContextRoot: (contextRoot) => {
      if (contextRoot.length !== 32) {
        throw new Error("Context root must be 32 bytes");
      }
      return keys(Uint8Array.from(contextRoot), "nearkat/kat/");
    },
    sessionKey: () => derive(root, "nearkat/session"),
    nearPrivateKey: () => `ed25519:${base58.encode(Buffer.concat([seed, publicBytes]))}`,
    nearPublicKey: () => `ed25519:${base58.encode(publicBytes)}`,
  });
  return keys(root, "nearkat/kat/");
}

/** Reads the local-mode root secret: 64 hex characters. */
export function localRootSecret(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("KEEPER_ROOT_SECRET must be 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}
