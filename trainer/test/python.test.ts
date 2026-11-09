import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { type Progress, PythonError, runPython } from "../src/python.ts";

const FAKE = [process.execPath, join(import.meta.dirname, "fixtures/fake-train.mjs")];
const scratch = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();
const runDirs = () => readdirSync(scratch).filter((name) => name.startsWith("kat-run-"));

async function* samples(items: Array<[string, string]>) {
  for (const [label, jpeg] of items) {
    yield { label, jpeg: Buffer.from(jpeg) };
  }
}

afterEach(() => {
  delete process.env.FAKE_TRAIN_MODE;
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
    // The model file is gone once read back.
    expect(runDirs()).toEqual(before);
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
    expect(JSON.stringify(error)).not.toContain(
      Buffer.from("secret-image-bytes").toString("base64"),
    );
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
