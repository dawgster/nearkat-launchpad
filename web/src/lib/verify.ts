import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { ContextDoc, Verification } from "./keeper.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error("Not a hex string");
  }
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/**
 * The hash the contract records for a context: SHA-256 over the salt bytes
 * followed by the JSON of every other field in this fixed order. It must
 * match the keeper's `contextHash` byte for byte.
 */
export function contextHash(doc: ContextDoc): string {
  const canonical = JSON.stringify({
    token_id: doc.token_id,
    version: doc.version,
    personality: doc.personality,
    memory_summary: doc.memory_summary,
  });
  const salt = fromBase64(doc.salt);
  const input = new Uint8Array(salt.length + utf8(canonical).length);
  input.set(salt);
  input.set(utf8(canonical), salt.length);
  return toBase64(sha256(input));
}

export type SignatureCheck =
  /** No signature came back with the reply. */
  | { status: "missing" }
  /** The signature is not one this app knows how to check. */
  | { status: "unsupported"; algo: string }
  | { status: "invalid" }
  /**
   * Signed by `signer`. `coversReply` says whether the signed text names this
   * reply's request and response hashes.
   */
  | { status: "valid"; signer: string; kind: string; coversReply: boolean };

/** Recovers the Ethereum-style address that signed `text` (EIP-191 personal sign). */
function recoverEthereumSigner(text: string, signatureHex: string): string {
  const signature = fromHex(signatureHex);
  if (signature.length !== 65) {
    throw new Error("An ECDSA signature must be 65 bytes");
  }
  const message = utf8(text);
  const digest = keccak_256(
    new Uint8Array([...utf8(`\x19Ethereum Signed Message:\n${message.length}`), ...message]),
  );
  const v = signature[64] as number;
  const recovery = v >= 27 ? v - 27 : v;
  const publicKey = secp256k1.Signature.fromBytes(signature.subarray(0, 64), "compact")
    .addRecoveryBit(recovery)
    .recoverPublicKey(digest)
    .toBytes(false);
  return `0x${toHex(keccak_256(publicKey.subarray(1)).subarray(12))}`;
}

/**
 * Checks the inference provider's signature on a reply. This shows that the
 * holder of the signing key signed these hashes; it does not show which
 * hardware holds that key, which needs the provider's attestation report.
 */
export function checkSignature(verification: Verification): SignatureCheck {
  const info = verification.signature;
  if (!info) {
    return { status: "missing" };
  }
  const coversReply =
    info.text.includes(verification.request_hash) && info.text.includes(verification.response_hash);
  try {
    if (info.signing_algo === "ecdsa") {
      const signer = recoverEthereumSigner(info.text, info.signature);
      return signer === info.signing_address.toLowerCase()
        ? { status: "valid", signer, kind: info.signature_kind, coversReply }
        : { status: "invalid" };
    }
    if (info.signing_algo === "ed25519") {
      const valid = ed25519.verify(
        fromHex(info.signature),
        utf8(info.text),
        fromHex(info.signing_address),
      );
      return valid
        ? { status: "valid", signer: info.signing_address, kind: info.signature_kind, coversReply }
        : { status: "invalid" };
    }
  } catch {
    return { status: "invalid" };
  }
  return { status: "unsupported", algo: info.signing_algo };
}
