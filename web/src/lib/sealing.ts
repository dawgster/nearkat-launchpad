import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Seals a collection's secret instructions to the keeper's X25519 sealing
 * key, in the creator's browser, so they only ever exist in plain text there
 * and inside the TEE app. Must match the keeper's `src/sealing.ts`: ephemeral
 * public key (32) | nonce (12) | AES-256-GCM ciphertext and tag, base64; the
 * AES key is HKDF-SHA256 over the shared secret, salted with both keys.
 */
const INFO = "nearkat-sealed-prompt:v1";
/** For an owner's chat history, sealed for one token's mind. Must match the keeper's. */
export const IMPORT_INFO = "nearkat-history-import:v1";

function fromHex(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("A sealing key is 32 bytes of hex");
  }
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export async function sealPrompt(
  sealPublicKeyHex: string,
  plaintext: string,
  info = INFO,
): Promise<string> {
  const recipient = fromHex(sealPublicKeyHex);
  const ephemeralSecret = x25519.utils.randomSecretKey();
  const ephemeral = x25519.getPublicKey(ephemeralSecret);
  const shared = x25519.getSharedSecret(ephemeralSecret, recipient);
  const salt = new Uint8Array([...ephemeral, ...recipient]);
  const keyBytes = hkdf(sha256, shared, salt, new TextEncoder().encode(info), 32);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(info) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array([...ephemeral, ...nonce, ...sealed]);
  // In pieces: spreading a large history into one call overflows the stack.
  let binary = "";
  for (let i = 0; i < out.length; i += 0x8000) {
    binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
