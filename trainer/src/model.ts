import { open, seal } from "../../keeper/src/crypto.ts";

/**
 * A model token's id is this, then the run that trained it; `MODEL_TOKEN_PREFIX`
 * in contract/src/dataset.rs matches. Samples' ids are numbers.
 */
export const MODEL_TOKEN_PREFIX = "model-";

export const modelTokenId = (runId: string) => `${MODEL_TOKEN_PREFIX}${runId}`;

export const isModelToken = (tokenId: string) => tokenId.startsWith(MODEL_TOKEN_PREFIX);

/**
 * What a run learned, apart from the public backbone: the linear layer on
 * top of it, as `train.py --head-out` writes it and `assemble.py` reads it.
 */
export interface Head {
  /** How many features the backbone gives a picture. */
  features: number;
  /** SHA-256 of the backbone's weights the head was trained on. */
  backbone_sha256: string;
  /** Little-endian float32, one row of `features` weights a class; base64. */
  weight: string;
  /** Little-endian float32, one a class; base64. */
  bias: string;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Checks the shape of a head, whether Python wrote it or a sealed blob held it. */
export function parseHead(value: unknown): Head {
  const head = value as Partial<Head> | null;
  if (
    typeof head !== "object" ||
    head === null ||
    !Number.isInteger(head.features) ||
    (head.features as number) < 1 ||
    typeof head.backbone_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(head.backbone_sha256) ||
    typeof head.weight !== "string" ||
    typeof head.bias !== "string" ||
    !BASE64.test(head.weight) ||
    !BASE64.test(head.bias)
  ) {
    throw new Error("Not a model head");
  }
  const features = head.features as number;
  const classes = Buffer.from(head.bias, "base64").length / 4;
  if (
    !Number.isInteger(classes) ||
    classes < 1 ||
    Buffer.from(head.weight, "base64").length !== classes * features * 4
  ) {
    throw new Error("Not a model head");
  }
  return {
    features,
    backbone_sha256: head.backbone_sha256,
    weight: head.weight,
    bias: head.bias,
  };
}

/** A run's model, as it is sealed into FastFS under its token's key. */
export interface ModelDoc {
  v: 1;
  kind: "model-head";
  token_id: string;
  run_id: string;
  /** The dataset's classes, in the order of the head's rows. */
  classes: string[];
  head: Head;
}

/** The JSON that is sealed: every field, in a fixed order. */
const canonical = (doc: ModelDoc) =>
  JSON.stringify({
    v: doc.v,
    kind: doc.kind,
    token_id: doc.token_id,
    run_id: doc.run_id,
    classes: doc.classes,
    head: {
      features: doc.head.features,
      backbone_sha256: doc.head.backbone_sha256,
      weight: doc.head.weight,
      bias: doc.head.bias,
    },
  });

export function sealModel(key: Uint8Array, doc: ModelDoc): Buffer {
  return seal(key, Buffer.from(canonical(doc), "utf8"));
}

/** Throws if the blob was not sealed with this key, or is not this token's model. */
export function openModel(key: Uint8Array, blob: Uint8Array, tokenId: string): ModelDoc {
  let doc: ModelDoc | null;
  try {
    doc = JSON.parse(open(key, blob).toString("utf8")) as ModelDoc | null;
  } catch {
    throw new Error(`Model ${tokenId} cannot be decrypted`);
  }
  if (
    typeof doc !== "object" ||
    doc === null ||
    doc.v !== 1 ||
    doc.kind !== "model-head" ||
    doc.token_id !== tokenId ||
    doc.token_id !== modelTokenId(doc.run_id) ||
    !Array.isArray(doc.classes) ||
    !doc.classes.every((name) => typeof name === "string")
  ) {
    throw new Error(`The blob is not model ${tokenId}`);
  }
  let head: Head;
  try {
    head = parseHead(doc.head);
  } catch {
    throw new Error(`The blob is not model ${tokenId}`);
  }
  if (Buffer.from(head.bias, "base64").length / 4 !== doc.classes.length) {
    throw new Error(`The blob is not model ${tokenId}`);
  }
  return { ...doc, head };
}
