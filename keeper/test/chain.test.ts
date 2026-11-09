import { describe, expect, test } from "vitest";
import { mpcAnswerIn, sampleKeyAnswers, transactionArgsFrom } from "../src/chain.ts";

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("transactionArgsFrom", () => {
  test("returns every function call's arguments in order, skipping other actions", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          result: {
            transaction: {
              actions: [
                { FunctionCall: { method_name: "__fastdata_fastfs", args: b64("one") } },
                { Transfer: { deposit: "1" } },
                { FunctionCall: { method_name: "__fastdata_fastfs", args: b64("two") } },
                "CreateAccount",
              ],
            },
          },
        }),
      )) as unknown as typeof fetch;
    const args = await transactionArgsFrom("http://rpc", fetchImpl)("hash", "keeper.near");
    expect(args.map((a) => Buffer.from(a).toString())).toEqual(["one", "two"]);
  });

  test("says the transaction was not found when it has no calls", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { name: "UNKNOWN_TRANSACTION" } }))) as typeof fetch;
    await expect(transactionArgsFrom("http://rpc", fetchImpl)("hash", "k.near")).rejects.toThrow(
      /Transaction hash not found/,
    );
  });
});

describe("mpcAnswerIn", () => {
  test("parses the JSON the call returned", () => {
    expect(mpcAnswerIn({ status: { SuccessValue: b64('[{"a":1}]') } }, "sample keys")).toEqual([
      { a: 1 },
    ]);
  });

  test("says what came back when the call returned no value", () => {
    for (const status of [{ SuccessReceiptId: "abc" }, { SuccessValue: "" }, undefined]) {
      expect(() => mpcAnswerIn({ status }, "context key")).toThrow(
        /gave no context key: the call returned/,
      );
    }
    expect(() => mpcAnswerIn({ status: { SuccessReceiptId: "abc" } }, "x")).toThrow(
      /SuccessReceiptId/,
    );
  });

  test("calls a value that isn't JSON malformed", () => {
    expect(() => mpcAnswerIn({ status: { SuccessValue: b64("not json") } }, "x")).toThrow(
      /malformed/,
    );
  });
});

describe("sampleKeyAnswers", () => {
  test("keeps well-formed answers in order and nulls the rest", () => {
    expect(sampleKeyAnswers([{ big_y: "y", big_c: "c" }, null, { big_y: 1 }], 3)).toEqual([
      { big_y: "y", big_c: "c" },
      null,
      null,
    ]);
  });

  test("refuses a list of the wrong length", () => {
    expect(() => sampleKeyAnswers([], 1)).toThrow(/malformed/);
    expect(() => sampleKeyAnswers({}, 1)).toThrow(/malformed/);
  });
});
