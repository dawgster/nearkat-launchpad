import { describe, expect, test } from "vitest";
import { createKeeper, KeeperError } from "../src/lib/keeper.ts";

interface Call {
  url: string;
  init: RequestInit;
}

function setup(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const keeper = createKeeper("https://keeper.example", (async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch);
  return { keeper, calls };
}

describe("createKeeper", () => {
  test("sends the session token and JSON body to the kat's route", async () => {
    const { keeper, calls } = setup(() => Response.json({ reply: "meow" }));
    expect(await keeper.chat("tok", "7", "hello")).toEqual({ reply: "meow" });
    expect(calls[0]?.url).toBe("https://keeper.example/kats/7/chat");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
  });

  test("has no way to write a kat's character", () => {
    const { keeper } = setup(() => Response.json({}));
    expect("setPersonality" in keeper).toBe(false);
  });

  test("uses the right method and path for each call", async () => {
    const { keeper, calls } = setup(() => Response.json({}));
    await keeper.attestation();
    await keeper.challenge();
    await keeper.createSession("n", { accountId: "a.near", publicKey: "pk", signature: "sig" });
    await keeper.getContext("tok", "7");
    await keeper.exportMind("tok", "7", "lantern.near");
    expect(calls.map((call) => `${call.init.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /attestation",
      "POST /auth/challenge",
      "POST /auth/session",
      "GET /kats/7/context",
      "GET /c/lantern.near/kats/7/export",
    ]);
    expect(calls[2]?.init.body).toBe(
      JSON.stringify({
        nonce: "n",
        signed_message: { accountId: "a.near", publicKey: "pk", signature: "sig" },
      }),
    );
  });

  test("escapes a token id so it cannot change the path", async () => {
    const { keeper, calls } = setup(() => Response.json({}));
    await keeper.getContext("tok", "1/../2");
    expect(calls[0]?.url).toBe("https://keeper.example/kats/1%2F..%2F2/context");
  });

  test("turns an error response into a KeeperError carrying its details", async () => {
    const { keeper } = setup(() =>
      Response.json(
        { error: "insufficient_balance", message: "Kat 7 needs more NEAR", balance: "5" },
        { status: 402 },
      ),
    );
    const error = await keeper.chat("tok", "7", "hi").catch((caught) => caught);
    expect(error).toBeInstanceOf(KeeperError);
    expect(error).toMatchObject({
      status: 402,
      code: "insufficient_balance",
      message: "Kat 7 needs more NEAR",
      extra: { balance: "5" },
    });
  });

  test("reports an error response that is not JSON", async () => {
    const { keeper } = setup(() => new Response("Bad Gateway", { status: 502 }));
    await expect(keeper.attestation()).rejects.toMatchObject({ status: 502, code: "unknown" });
  });

  test("reports an unreachable keeper as its own kind of error", async () => {
    const { keeper } = setup(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(keeper.attestation()).rejects.toMatchObject({ status: 0, code: "unreachable" });
  });
});
