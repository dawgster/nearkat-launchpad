import { createHash, randomBytes } from "node:crypto";
import { DEFAULT_COLLECTION } from "./collection.ts";
import { open, seal } from "./crypto.ts";
import { CorruptContextError } from "./errors.ts";
import type { Keys } from "./keys.ts";
import type { ContextDoc } from "./types.ts";

/** The original collection's starter context. */
export const STARTER_PERSONALITY = DEFAULT_COLLECTION.starter;

/** The JSON that is hashed: every field except the salt, in a fixed order. */
export function canonicalJson(doc: ContextDoc): string {
  return JSON.stringify({
    token_id: doc.token_id,
    version: doc.version,
    personality: doc.personality,
    memory_summary: doc.memory_summary,
  });
}

/** SHA-256 over salt bytes followed by the canonical JSON. */
export function contextHash(doc: ContextDoc): Buffer {
  return createHash("sha256")
    .update(Buffer.from(doc.salt, "base64"))
    .update(canonicalJson(doc), "utf8")
    .digest();
}

/** Builds a context with a fresh salt, so equal contents never share a hash. */
export function newContext(
  tokenId: string,
  version: number,
  personality: string,
  memorySummary: string,
): ContextDoc {
  return {
    token_id: tokenId,
    version,
    salt: randomBytes(32).toString("base64"),
    personality,
    memory_summary: memorySummary,
  };
}

export function sealContext(keys: Keys, doc: ContextDoc): Buffer {
  return seal(keys.katKey(doc.token_id), Buffer.from(JSON.stringify(doc), "utf8"));
}

/** Decrypts a context and checks it against the hash recorded on-chain. */
export function openContext(
  keys: Keys,
  tokenId: string,
  blob: Uint8Array,
  expectedHashB64: string,
): ContextDoc {
  let doc: ContextDoc;
  try {
    doc = JSON.parse(open(keys.katKey(tokenId), blob).toString("utf8")) as ContextDoc;
  } catch {
    throw new CorruptContextError(`Context of kat ${tokenId} cannot be decrypted`);
  }
  const matches =
    doc.token_id === tokenId && contextHash(doc).toString("base64") === expectedHashB64;
  if (!matches) {
    throw new CorruptContextError(`Context of kat ${tokenId} does not match its on-chain hash`);
  }
  return doc;
}
