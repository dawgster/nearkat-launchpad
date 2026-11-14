import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sealSample } from "../../keeper/src/samples.ts";
import {
  isModelToken,
  type ModelDoc,
  modelTokenId,
  openModel,
  parseHead,
  sealModel,
} from "../src/model.ts";
import { HEAD } from "./fakes.ts";

const key = randomBytes(32);
const doc: ModelDoc = {
  v: 1,
  kind: "model-head",
  token_id: "model-run-1",
  run_id: "run-1",
  classes: ["cat", "dog"],
  head: HEAD,
};

describe("model tokens", () => {
  test("a model token is named after its run", () => {
    expect(modelTokenId("run-0a1b2c3d4e5f")).toBe("model-run-0a1b2c3d4e5f");
    expect(isModelToken("model-run-0a1b2c3d4e5f")).toBe(true);
    expect(isModelToken("17")).toBe(false);
  });

  test("a sealed model opens with its key, for its token", () => {
    const blob = sealModel(key, doc);
    expect(openModel(key, blob, "model-run-1")).toEqual(doc);
    expect(blob.toString("latin1")).not.toContain(HEAD.weight);
  });

  test("it does not open with another key, or as another token", () => {
    const blob = sealModel(key, doc);
    expect(() => openModel(randomBytes(32), blob, "model-run-1")).toThrow(
      "Model model-run-1 cannot be decrypted",
    );
    expect(() => openModel(key, blob, "model-run-2")).toThrow("The blob is not model model-run-2");
  });

  test("a model whose token is not its run's is refused", () => {
    const blob = sealModel(key, { ...doc, run_id: "run-2" });
    expect(() => openModel(key, blob, "model-run-1")).toThrow("The blob is not model model-run-1");
  });

  test("a sample is not a model", () => {
    const blob = sealSample(key, { v: 1, token_id: "model-run-1", label: "cat", jpeg: "AAAA" });
    expect(() => openModel(key, blob, "model-run-1")).toThrow("The blob is not model model-run-1");
  });

  test("the head has a row of weights and a bias for every class", () => {
    const blob = sealModel(key, { ...doc, classes: ["cat", "dog", "bird"] });
    expect(() => openModel(key, blob, "model-run-1")).toThrow("The blob is not model model-run-1");
  });

  test("a head is checked for its shape", () => {
    expect(parseHead({ ...HEAD, extra: 1 })).toEqual(HEAD);
    for (const bad of [
      null,
      "head",
      { ...HEAD, features: 0 },
      { ...HEAD, backbone_sha256: "abc" },
      { ...HEAD, weight: "not base64!" },
      { ...HEAD, bias: "" },
      { ...HEAD, weight: Buffer.alloc(12).toString("base64") },
      { ...HEAD, bias: Buffer.alloc(6).toString("base64") },
    ]) {
      expect(() => parseHead(bad)).toThrow("Not a model head");
    }
  });
});
