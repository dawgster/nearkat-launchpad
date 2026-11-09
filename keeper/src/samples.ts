import { open, seal } from "./crypto.ts";

/** What a dataset's samples are sealed for; see `sealSample`. */
export const SAMPLE_INFO = "nearkat-dataset-sample:v1";

/** One training sample, as it is sealed into FastFS. */
export interface SampleDoc {
  v: 1;
  token_id: string;
  label: string;
  /** The JPEG, base64. */
  jpeg: string;
}

/** The JSON that is sealed: every field, in a fixed order. */
const canonical = (doc: SampleDoc) =>
  JSON.stringify({ v: doc.v, token_id: doc.token_id, label: doc.label, jpeg: doc.jpeg });

export function sealSample(key: Uint8Array, doc: SampleDoc): Buffer {
  return seal(key, Buffer.from(canonical(doc), "utf8"));
}

/** Throws if the blob was not sealed with this key, or is another token's sample. */
export function openSample(key: Uint8Array, blob: Uint8Array, tokenId: string): SampleDoc {
  let doc: SampleDoc | null;
  try {
    doc = JSON.parse(open(key, blob).toString("utf8")) as SampleDoc | null;
  } catch {
    throw new Error(`Sample ${tokenId} cannot be decrypted`);
  }
  if (typeof doc !== "object" || doc === null || doc.v !== 1 || doc.token_id !== tokenId) {
    throw new Error(`The blob is not sample ${tokenId}`);
  }
  return doc;
}
