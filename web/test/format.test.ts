import { describe, expect, test } from "vitest";
import { formatNear, parseNear, shorten } from "../src/lib/format.ts";

const NEAR = 10n ** 24n;

describe("formatNear", () => {
  test.each([
    [0n, "0"],
    [NEAR, "1"],
    [NEAR + NEAR / 2n, "1.5"],
    [2n * 10n ** 21n, "0.002"],
    [1234567n * 10n ** 18n, "1.234"],
    [10n ** 20n, "0"],
    [-NEAR / 4n, "-0.25"],
  ])("formats %s yocto as %s", (yocto, text) => {
    expect(formatNear(yocto)).toBe(text);
  });

  test("accepts a string and a custom precision", () => {
    expect(formatNear("1234567000000000000000000", 5)).toBe("1.23456");
  });
});

describe("parseNear", () => {
  test.each([
    ["1", NEAR],
    ["0.5", NEAR / 2n],
    [" 2.25 ", (NEAR * 9n) / 4n],
    ["0.000000000000000000000001", 1n],
    ["0", 0n],
  ])("parses %j", (text, yocto) => {
    expect(parseNear(text)).toBe(yocto);
  });

  test.each(["", "abc", "-1", "1.", ".5", "1e3", "1,5", "0.0000000000000000000000001"])(
    "rejects %j",
    (text) => {
      expect(parseNear(text)).toBeNull();
    },
  );
});

describe("shorten", () => {
  test("keeps short text whole and trims the middle of long text", () => {
    expect(shorten("alice.near")).toBe("alice.near");
    expect(shorten("a".repeat(10) + "b".repeat(44) + "c".repeat(10))).toBe("aaaaaaaa…cccccccc");
  });
});
