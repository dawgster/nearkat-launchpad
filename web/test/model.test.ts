import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, test, vi } from "vitest";
import {
  type Classifier,
  declaredSize,
  heldoutAccuracy,
  INPUT_SIZE,
  loadModel,
  type Pixels,
  toInput,
} from "../src/lib/model.ts";

const PLANE = INPUT_SIZE * INPUT_SIZE;
const at = (channel: number, y: number, x: number, size = INPUT_SIZE) =>
  channel * size * size + y * size + x;

describe("toInput", () => {
  test("is 224×224 by default, the size the trainer's models take", async () => {
    expect(INPUT_SIZE).toBe(224);
    const input = await toInput({ width: 1, height: 1, data: [0, 0, 0, 255] });
    expect(input.length).toBe(3 * 224 * 224);
  });

  test("toInput squashes to size×size RGB in [0,1], channels first", async () => {
    // Two pixels side by side: red, then blue.
    const redBlue: Pixels = { width: 2, height: 1, data: [255, 0, 0, 255, 0, 0, 255, 255] };
    const input = await toInput(redBlue, 64);
    const at64 = (channel: number, y: number, x: number) => at(channel, y, x, 64);
    expect(input).toBeInstanceOf(Float32Array);
    expect(input.length).toBe(3 * 64 * 64);
    expect(Math.min(...input)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...input)).toBeLessThanOrEqual(1);
    for (const y of [0, 31, 63]) {
      // Left edge: red. Right edge: blue. No green anywhere.
      expect(input[at64(0, y, 0)]).toBeCloseTo(1);
      expect(input[at64(2, y, 0)]).toBeCloseTo(0);
      expect(input[at64(0, y, 63)]).toBeCloseTo(0);
      expect(input[at64(2, y, 63)]).toBeCloseTo(1);
      expect(input[at64(1, y, 31)]).toBeCloseTo(0);
    }
    // Squashed, not cropped: the middle blends the two.
    expect(input[at64(0, 0, 31)]).toBeCloseTo(0.515625);
    expect(input[at64(2, 0, 32)]).toBeCloseTo(0.515625);
  });

  test("ignores alpha and scales bytes to [0,1]", async () => {
    const grey: Pixels = { width: 1, height: 1, data: [51, 102, 204, 0] };
    const input = await toInput(grey);
    expect(input[at(0, 10, 10)]).toBeCloseTo(0.2);
    expect(input[at(1, 10, 10)]).toBeCloseTo(0.4);
    expect(input[at(2, 10, 10)]).toBeCloseTo(0.8);
  });
});

describe("declaredSize", () => {
  test("reads the square side from the model's input shape", () => {
    expect(declaredSize({ isTensor: true, shape: ["batch", 3, 128, 128] })).toBe(128);
  });

  test("falls back to INPUT_SIZE when the model doesn't say", () => {
    expect(declaredSize(undefined)).toBe(INPUT_SIZE);
    expect(declaredSize({ isTensor: false })).toBe(INPUT_SIZE);
    expect(declaredSize({ isTensor: true, shape: [] })).toBe(INPUT_SIZE);
    expect(declaredSize({ isTensor: true, shape: ["batch", 3, "h", "w"] })).toBe(INPUT_SIZE);
    expect(declaredSize({ isTensor: true, shape: [1, 3, 64, 32] })).toBe(INPUT_SIZE);
  });
});

describe("loadModel", () => {
  const bytes = new TextEncoder().encode("model bytes");
  const hash = bytesToHex(sha256(bytes));

  test("loadModel refuses bytes whose hash isn't on-chain", async () => {
    const create = vi.fn();
    await expect(loadModel(bytes, "00".repeat(32), { create })).rejects.toThrow(
      "This model isn't the one recorded on-chain",
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("classifies with a softmax over the logits, in the classes' order", async () => {
    const run = vi.fn(async () => Float32Array.from([0, Math.log(3)]));
    const classifier = await loadModel(bytes, hash.toUpperCase(), {
      create: async (model) => {
        expect(model).toEqual(bytes);
        return { run };
      },
    });
    const result = await classifier.classify({ width: 1, height: 1, data: [0, 0, 0, 255] }, [
      "hotdog",
      "not_hotdog",
    ]);
    expect(result.label).toBe("not_hotdog");
    expect(result.confidence).toBeCloseTo(0.75);
    expect((run.mock.calls[0] as unknown as [Float32Array])[0].length).toBe(3 * PLANE);
  });

  test("feeds the model pictures at the size it declares", async () => {
    const run = vi.fn(async () => Float32Array.from([1, 0]));
    const classifier = await loadModel(bytes, hash, { create: async () => ({ size: 32, run }) });
    await classifier.classify({ width: 1, height: 1, data: [0, 0, 0, 255] }, ["a", "b"]);
    expect((run.mock.calls[0] as unknown as [Float32Array])[0].length).toBe(3 * 32 * 32);
  });

  test("refuses a model with a different number of classes", async () => {
    const classifier = await loadModel(bytes, hash, {
      create: async () => ({ run: async () => Float32Array.from([1, 2, 3]) }),
    });
    await expect(
      classifier.classify({ width: 1, height: 1, data: [0, 0, 0, 255] }, ["a", "b"]),
    ).rejects.toThrow(/3 classes/);
  });
});

describe("heldoutAccuracy", () => {
  test("scores the classifier on the public held-out set", async () => {
    const manifest = readFileSync(resolve(import.meta.dirname, "fixtures/heldout/manifest.json"));
    const fetched: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      fetched.push(url);
      return url.endsWith("manifest.json")
        ? new Response(manifest)
        : new Response(new Blob([url], { type: "image/jpeg" }));
    });
    const decode = vi.fn(
      async (): Promise<Pixels> => ({ width: 1, height: 1, data: [0, 0, 0, 255] }),
    );
    // Right about both hotdogs and the first other picture, wrong about the last.
    const answers = ["hotdog", "hotdog", "not_hotdog", "hotdog"];
    const classifier: Classifier = {
      classify: async () => ({ label: answers.shift() as string, confidence: 1 }),
    };
    const accuracy = await heldoutAccuracy(classifier, ["hotdog", "not_hotdog"], {
      fetch: fetchImpl as unknown as typeof fetch,
      decode,
    });
    expect(accuracy).toBeCloseTo(0.75);
    expect(decode).toHaveBeenCalledTimes(4);
    expect(fetched).toEqual([
      "/heldout/manifest.json",
      "/heldout/hotdog/a.jpg",
      "/heldout/hotdog/b.jpg",
      "/heldout/not_hotdog/c.jpg",
      "/heldout/not_hotdog/d.jpg",
    ]);
  });

  test("decodes held-out pictures as they are, without EXIF rotation or colour conversion", async () => {
    const manifest = JSON.stringify({ files: [{ path: "hotdog/a.jpg", label: "hotdog" }] });
    const fetchImpl = async (url: string) =>
      url.endsWith("manifest.json") ? new Response(manifest) : new Response(new Blob(["x"]));
    const bitmap = { width: 1, height: 1, close: vi.fn() };
    const create = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", create);
    try {
      await heldoutAccuracy(
        { classify: async () => ({ label: "hotdog", confidence: 1 }) },
        ["hotdog"],
        {
          fetch: fetchImpl as unknown as typeof fetch,
        },
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(create).toHaveBeenCalledWith(expect.any(Blob), {
      imageOrientation: "none",
      colorSpaceConversion: "none",
    });
  });

  test("says so when there is no held-out set", async () => {
    const fetchImpl = async () => new Response("nope", { status: 404 });
    await expect(
      heldoutAccuracy({ classify: vi.fn() }, ["hotdog", "not_hotdog"], {
        fetch: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("The held-out set isn't available here");
  });
});
