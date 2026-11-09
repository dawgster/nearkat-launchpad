import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { countHeldout } from "../src/heldout.ts";

test("counts the jpegs in each class directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "heldout-"));
  for (const [cls, files] of [
    ["cat", ["a.jpg", "b.jpeg", "notes.txt"]],
    ["dog", ["c.JPG"]],
  ] as const) {
    mkdirSync(join(dir, cls));
    for (const file of files) {
      writeFileSync(join(dir, cls, file), "x");
    }
  }
  expect(countHeldout(dir)).toBe(4 - 1);
  expect(countHeldout(join(dir, "missing"))).toBe(0);
});
