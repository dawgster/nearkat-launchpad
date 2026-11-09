import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The model's input is a square of this many pixels a side. */
export const INPUT_SIZE = 64;
/** Bigger photos are shrunk on a canvas first, so the filter below stays quick. */
const MAX_SIDE = 512;

/** RGBA bytes, row by row, as `ImageData` holds them. */
export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export type Picture = ImageBitmap | Pixels;

export interface Classifier {
  classify(image: Picture, classes: string[]): Promise<{ label: string; confidence: number }>;
}

/** Runs the ONNX model. Swappable in tests. */
export interface Runtime {
  create(model: Uint8Array): Promise<{ run(input: Float32Array): Promise<Float32Array> }>;
}

function pixelsOf(image: Picture): Pixels {
  if ("data" in image) {
    return image;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context) {
    throw new Error("This browser can't read the picture's pixels.");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

/**
 * Bilinear weights for resizing `inSize` samples to `outSize`, widened when
 * shrinking so every input sample counts (the filter Pillow uses, so pictures
 * look to the model in the browser as they did when it was trained).
 */
function filter(inSize: number, outSize: number): Array<{ start: number; weights: number[] }> {
  const scale = inSize / outSize;
  const support = Math.max(scale, 1);
  return Array.from({ length: outSize }, (_, out) => {
    const center = (out + 0.5) * scale;
    const start = Math.max(0, Math.trunc(center - support + 0.5));
    const end = Math.min(inSize, Math.trunc(center + support + 0.5));
    const weights = Array.from({ length: end - start }, (_, i) =>
      Math.max(0, 1 - Math.abs((start + i - center + 0.5) / support)),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return { start, weights: weights.map((weight) => weight / total) };
  });
}

/**
 * The model's input for a picture: squashed (not cropped) to 64×64, RGB in
 * [0,1], channels first, as `[1, 3, 64, 64]`.
 */
export async function toInput(image: Picture): Promise<Float32Array> {
  const { width, height, data } = pixelsOf(image);
  const across = filter(width, INPUT_SIZE);
  const down = filter(height, INPUT_SIZE);
  // Across each row first, then down each column.
  const rows = new Float32Array(height * INPUT_SIZE * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < INPUT_SIZE; x++) {
      const { start, weights } = across[x] as (typeof across)[number];
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let i = 0; i < weights.length; i++) {
          sum += (weights[i] as number) * (data[(y * width + start + i) * 4 + c] as number);
        }
        rows[(y * INPUT_SIZE + x) * 3 + c] = sum;
      }
    }
  }
  const plane = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < INPUT_SIZE; y++) {
    const { start, weights } = down[y] as (typeof down)[number];
    for (let x = 0; x < INPUT_SIZE; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let i = 0; i < weights.length; i++) {
          sum += (weights[i] as number) * (rows[((start + i) * INPUT_SIZE + x) * 3 + c] as number);
        }
        input[c * plane + y * INPUT_SIZE + x] = Math.min(1, Math.max(0, sum / 255));
      }
    }
  }
  return input;
}

/** onnxruntime-web on its wasm backend, loaded only when a model is. */
const onnxRuntime: Runtime = {
  async create(model) {
    const ort = await import("onnxruntime-web/wasm");
    // The model is tiny; threads would need a cross-origin isolated page.
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(model.slice(), {
      executionProviders: ["wasm"],
    });
    return {
      async run(input) {
        const outputs = await session.run({
          image: new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]),
        });
        return Float32Array.from(outputs.logits?.data as Float32Array);
      },
    };
  },
};

/**
 * Opens a model, after checking it is byte for byte the one whose hash the
 * contract recorded for the run.
 */
export async function loadModel(
  bytes: Uint8Array,
  expectedSha256: string,
  runtime: Runtime = onnxRuntime,
): Promise<Classifier> {
  if (bytesToHex(sha256(bytes)) !== expectedSha256.toLowerCase()) {
    throw new Error("This model isn't the one recorded on-chain");
  }
  const model = await runtime.create(bytes);
  return {
    async classify(image, classes) {
      const logits = await model.run(await toInput(image));
      if (logits.length !== classes.length) {
        throw new Error(
          `The model tells ${logits.length} classes apart; this collection has ${classes.length}.`,
        );
      }
      const top = Math.max(...logits);
      const odds = Array.from(logits, (logit) => Math.exp(logit - top));
      const total = odds.reduce((sum, value) => sum + value, 0);
      const best = odds.indexOf(Math.max(...odds));
      return { label: classes[best] as string, confidence: (odds[best] as number) / total };
    },
  };
}

interface Manifest {
  classes: string[];
  files: Array<{ path: string; label: string }>;
}

/**
 * The classifier's accuracy, 0 to 1, on the public held-out set the training
 * app scores models on, served at `/heldout/`.
 */
export async function heldoutAccuracy(
  classifier: Classifier,
  classes: string[],
  options: {
    fetch?: typeof fetch;
    decode?: (blob: Blob) => Promise<Picture>;
    base?: string;
  } = {},
): Promise<number> {
  const fetchImpl = options.fetch ?? fetch;
  // The training app scores these files as they are: no EXIF rotation, no colour-profile conversion.
  const decode =
    options.decode ??
    ((blob: Blob) =>
      createImageBitmap(blob, { imageOrientation: "none", colorSpaceConversion: "none" }));
  const base = options.base ?? "/heldout";
  const missing = () => new Error("The held-out set isn't available here");
  let manifest: Manifest;
  try {
    const response = await fetchImpl(`${base}/manifest.json`);
    if (!response.ok) {
      throw missing();
    }
    manifest = (await response.json()) as Manifest;
  } catch {
    throw missing();
  }
  const files = (Array.isArray(manifest.files) ? manifest.files : []).filter((file) =>
    classes.includes(file.label),
  );
  if (files.length === 0) {
    throw missing();
  }
  let correct = 0;
  for (const file of files) {
    const response = await fetchImpl(`${base}/${file.path}`);
    if (!response.ok) {
      throw new Error(`Couldn't fetch the held-out image ${file.path}`);
    }
    const image = await decode(await response.blob());
    try {
      if ((await classifier.classify(image, classes)).label === file.label) {
        correct += 1;
      }
    } finally {
      if ("close" in image) {
        image.close();
      }
    }
  }
  return correct / files.length;
}
