import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { Head } from "../src/model.ts";
import { assembleModel, type Progress, PythonError, runPython } from "../src/python.ts";

const FAKE = [process.execPath, join(import.meta.dirname, "fixtures/fake-train.mjs")];
const FAKE_ASSEMBLE = [process.execPath, join(import.meta.dirname, "fixtures/fake-assemble.mjs")];
const HEAD: Head = {
  features: 1,
  backbone_sha256: "cd".repeat(32),
  weight: Buffer.from(new Float32Array([1, 2]).buffer).toString("base64"),
  bias: Buffer.from(new Float32Array([3, 4]).buffer).toString("base64"),
};
const scratch = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();
const runDirs = () => readdirSync(scratch).filter((name) => name.startsWith("kat-run-"));

async function* samples(items: Array<[string, string]>) {
  for (const [label, jpeg] of items) {
    yield { label, jpeg: Buffer.from(jpeg) };
  }
}

afterEach(() => {
  delete process.env.FAKE_TRAIN_MODE;
  delete process.env.FAKE_ASSEMBLE_MODE;
});

describe("runPython", () => {
  test("streams samples in, reports progress and returns the model", async () => {
    const before = runDirs();
    const progress: Progress[] = [];
    const result = await runPython({
      classes: ["cat", "dog"],
      heldoutDir: "/heldout",
      samples: samples([
        ["cat", "one"],
        ["dog", "two"],
      ]),
      onProgress: (p) => progress.push(p),
      command: FAKE,
    });
    expect(result.accuracy).toBe(0.5);
    expect(result.heldout).toBe(4);
    expect(result.model.toString()).toBe("model for cat,dog from /heldout: cat:one,dog:two");
    expect(progress.map((p) => p.stage)).toEqual(["loaded", "epoch", "done"]);
    // The head it trained comes back on its own: one row of weights and one bias a class.
    expect(result.head.features).toBe(1);
    expect(Buffer.from(result.head.bias, "base64")).toHaveLength(2 * 4);
    // The model file is gone once read back.
    expect(runDirs()).toEqual(before);
  });

  test("fails when Python wrote no head", async () => {
    process.env.FAKE_TRAIN_MODE = "no-head";
    await expect(
      runPython({
        classes: ["cat", "dog"],
        heldoutDir: "/heldout",
        samples: samples([["cat", "x"]]),
        onProgress: () => {},
        command: FAKE,
      }),
    ).rejects.toBeInstanceOf(PythonError);
  });

  test("fails without echoing what Python printed", async () => {
    process.env.FAKE_TRAIN_MODE = "fail";
    const error = await runPython({
      classes: ["cat", "dog"],
      heldoutDir: "/heldout",
      samples: samples([["cat", "secret-image-bytes"]]),
      onProgress: () => {},
      command: FAKE,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PythonError);
    expect(String((error as Error).message)).toBe("Training failed");
    // Python printed the sample's base64; nothing the error carries may hold it.
    const leaked = Buffer.from("secret-image-bytes").toString("base64");
    const carried = [
      (error as Error).message,
      (error as Error).stack ?? "",
      ...Object.getOwnPropertyNames(error).map((name) =>
        String((error as Record<string, unknown>)[name]),
      ),
      String((error as Error).cause ?? ""),
    ];
    for (const text of carried) {
      expect(text).not.toContain(leaked);
    }
  });

  test("fails when Python exits without a result", async () => {
    process.env.FAKE_TRAIN_MODE = "no-done";
    await expect(
      runPython({
        classes: ["cat", "dog"],
        heldoutDir: "/heldout",
        samples: samples([["cat", "x"]]),
        onProgress: () => {},
        command: FAKE,
      }),
    ).rejects.toBeInstanceOf(PythonError);
  });

  test("passes on an error from the samples and stops Python", async () => {
    async function* broken() {
      yield { label: "cat", jpeg: Buffer.from("x") };
      throw new Error("Sample 2 cannot be decrypted");
    }
    await expect(
      runPython({
        classes: ["cat", "dog"],
        heldoutDir: "/heldout",
        samples: broken(),
        onProgress: () => {},
        command: FAKE,
      }),
    ).rejects.toThrow("Sample 2 cannot be decrypted");
  });
});

describe("assembleModel", () => {
  test("hands Python the head and returns the model it rebuilt", async () => {
    const before = runDirs();
    const model = await assembleModel({ head: HEAD, command: FAKE_ASSEMBLE });
    expect(model.toString()).toBe(`model rebuilt from ${HEAD.weight} on ${HEAD.backbone_sha256}`);
    expect(runDirs()).toEqual(before);
  });

  test("fails without echoing what Python printed", async () => {
    process.env.FAKE_ASSEMBLE_MODE = "fail";
    const error = await assembleModel({ head: HEAD, command: FAKE_ASSEMBLE }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PythonError);
    expect(JSON.stringify(error) + String((error as Error).stack)).not.toContain(HEAD.weight);
  });

  test("fails when Python wrote no model", async () => {
    process.env.FAKE_ASSEMBLE_MODE = "no-file";
    await expect(assembleModel({ head: HEAD, command: FAKE_ASSEMBLE })).rejects.toBeInstanceOf(
      PythonError,
    );
  });
});
