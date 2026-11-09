import { describe, expect, test } from "vitest";
import { SAMPLE_INFO as KEEPER_SAMPLE_INFO } from "../../keeper/src/samples.ts";
import { sealingKey } from "../../keeper/src/sealing.ts";
import {
  classesFromFolders,
  classify,
  datasetProblem,
  filesFromEntries,
  MAX_JPEG_BYTES,
  sealSample,
  shrink,
} from "../src/lib/samples.ts";
import { SAMPLE_INFO } from "../src/lib/sealing.ts";

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });
const entry = (path: string, type = "image/jpeg") => ({
  path,
  file: file(path.split("/").at(-1) as string, type),
});

describe("classify", () => {
  const classes = ["hotdog", "not_hotdog"];

  test("classifies files by their nearest class folder", () => {
    const { samples, skipped } = classify(
      [
        entry("hotdog_nothotdog/train/hotdog/a.jpg"),
        entry("Not-Hotdog/b.png", "image/png"),
        entry("hotdog_nothotdog/.DS_Store", ""),
        entry("misc/c.jpg"),
        // No MIME type, but the extension says it is a picture.
        entry("not hotdog/d.WEBP", ""),
        // The nearest class wins.
        entry("hotdog/not_hotdog/e.jpeg"),
      ],
      classes,
    );
    expect(samples.map(({ path, label }) => [path, label])).toEqual([
      ["hotdog_nothotdog/train/hotdog/a.jpg", "hotdog"],
      // Within a class, by path in code-point order: capitals first.
      ["Not-Hotdog/b.png", "not_hotdog"],
      ["hotdog/not_hotdog/e.jpeg", "not_hotdog"],
      ["not hotdog/d.WEBP", "not_hotdog"],
    ]);
    expect(skipped).toEqual([
      { path: "hotdog_nothotdog/.DS_Store", reason: "not an image" },
      { path: "misc/c.jpg", reason: "no class folder" },
    ]);
  });

  test("orders samples the same way regardless of drop order", () => {
    const files = [
      entry("d/hotdog/3.jpg"),
      entry("d/not_hotdog/1.jpg"),
      entry("d/hotdog/1.jpg"),
      entry("d/not_hotdog/2.jpg"),
      entry("d/hotdog/2.jpg"),
      entry("e/hotdog/1.jpg"),
    ];
    const order = (list: typeof files) => classify(list, classes).samples.map((s) => s.path);
    const expected = [
      "d/hotdog/1.jpg",
      "d/hotdog/2.jpg",
      "d/hotdog/3.jpg",
      "e/hotdog/1.jpg",
      "d/not_hotdog/1.jpg",
      "d/not_hotdog/2.jpg",
    ];
    expect(order(files)).toEqual(expected);
    expect(order([...files].reverse())).toEqual(expected);
    expect(
      order([files[3], files[0], files[5], files[1], files[4], files[2]] as typeof files),
    ).toEqual(expected);
  });
});

test("finds the classes from the folders", () => {
  expect(
    classesFromFolders([
      "hotdog_nothotdog/train/not_hotdog/1.jpg",
      "hotdog_nothotdog/train/hotdog/1.jpg",
      "hotdog_nothotdog/test/hotdog/2.jpg",
      "hotdog_nothotdog/train/.DS_Store",
      "loose.jpg",
    ]),
  ).toEqual(["hotdog", "not_hotdog"]);
  expect(classesFromFolders(["Cats/a.png", "Big Dogs/b.jpeg", "big-dogs/c.jpg"])).toEqual([
    "big_dogs",
    "cats",
  ]);
});

test("checks a dataset against the contract's limits", () => {
  const classes = ["hotdog", "not_hotdog"];
  expect(datasetProblem(classes, ["hotdog", "not_hotdog"])).toBeNull();
  expect(datasetProblem(classes, [])).toMatch(/Drop a folder/);
  expect(datasetProblem(["hotdog"], ["hotdog"])).toMatch(/2 to 16 classes/);
  expect(datasetProblem(["hot dog", "x"], ["hot dog", "x"])).toMatch(/can't be a class/);
  expect(datasetProblem(classes, ["hotdog"])).toMatch(/no pictures for not_hotdog/);
  expect(
    datasetProblem(
      classes,
      [...Array(1001)].map((_, i) => classes[i % 2] as string),
    ),
  ).toMatch(/up to 1000/);
});

describe("shrink", () => {
  const blob = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });

  test("keeps the first quality that fits", async () => {
    const tried: number[] = [];
    const out = await shrink(async (quality) => {
      tried.push(quality);
      return blob(quality > 0.6 ? MAX_JPEG_BYTES + 1 : 1000);
    });
    expect(tried).toEqual([0.85, 0.7, 0.5]);
    expect(out?.size).toBe(1000);
  });

  test("gives up when even the lowest quality is too large", async () => {
    expect(await shrink(async () => blob(MAX_JPEG_BYTES + 1))).toBeNull();
  });
});

test("seals a sample so that only the keeper opens it, as a sample", async () => {
  expect(SAMPLE_INFO).toBe(KEEPER_SAMPLE_INFO);
  const keeper = sealingKey(new Uint8Array(32).fill(5));
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2]);
  const sealed = await sealSample(keeper.publicKeyHex, "hotdog", jpeg);
  expect(JSON.parse(keeper.open(sealed, KEEPER_SAMPLE_INFO))).toEqual({
    label: "hotdog",
    jpeg: Buffer.from(jpeg).toString("base64"),
  });
  expect(() => keeper.open(sealed)).toThrow();
});

test("reads every file in dropped folders, with their paths", async () => {
  // Directory readers hand entries out in batches, then an empty batch.
  const dir = (name: string, fullPath: string, children: unknown[]) => ({
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader: () => {
      const batches = [children.slice(0, 1), children.slice(1), []];
      return { readEntries: (ok: (e: unknown[]) => void) => ok(batches.shift() ?? []) };
    },
  });
  const leaf = (name: string, fullPath: string) => ({
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (ok: (f: File) => void) => ok(file(name, "image/jpeg")),
  });
  const files = await filesFromEntries([
    dir("set", "/set", [
      leaf("a.jpg", "/set/a.jpg"),
      dir("hotdog", "/set/hotdog", [leaf("b.jpg", "/set/hotdog/b.jpg")]),
    ]) as unknown as FileSystemEntry,
    leaf("c.jpg", "/c.jpg") as unknown as FileSystemEntry,
  ]);
  expect(files.map((f) => f.path).sort()).toEqual(["c.jpg", "set/a.jpg", "set/hotdog/b.jpg"]);
  expect(files.every((f) => f.file instanceof File)).toBe(true);
});
