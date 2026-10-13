import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { InferenceError } from "../src/errors.ts";
import { NearAiInference } from "../src/inference.ts";

const sha256 = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const completion =
  '{"id":"chat-1",  "choices":[{"message":{"role":"assistant","content":"meow"}}]}';
const signature = {
  text: "model:req:res",
  signature: "0xsig",
  signing_address: "0xabc",
  signing_algo: "ecdsa",
  signature_kind: "provider_tee",
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A request that never completes on its own, like a provider that stopped responding. */
function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}

function setup(
  respond: (
    url: string,
    attempt: number,
    signal: AbortSignal | null | undefined,
  ) => Response | Promise<Response>,
) {
  const calls: Call[] = [];
  const attempts = new Map<string, number>();
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    calls.push({ url, init });
    return respond(url, attempt, init?.signal);
  }) as typeof fetch;
  const inference = new NearAiInference({
    baseUrl: "https://ai.example/v1",
    apiKey: "secret",
    model: "test-model",
    fetch: fakeFetch,
    signatureRetryMs: 0,
    maxTokens: 256,
    timeoutMs: 30,
    signatureTimeoutMs: 30,
  });
  return { inference, calls };
}

const ok = (url: string) =>
  url.includes("/signature/") ? Response.json(signature) : new Response(completion);
const messages = [{ role: "user" as const, content: "hi" }];

describe("NearAiInference", () => {
  test("returns the reply with hashes of the exact bytes sent and received", async () => {
    const { inference, calls } = setup(ok);
    const result = await inference.chat(messages);
    expect(result.reply).toBe("meow");
    expect(result.verification).toEqual({
      chat_id: "chat-1",
      model: "test-model",
      request_hash: sha256(calls[0]?.init?.body as Uint8Array),
      response_hash: sha256(completion),
      signature,
    });
  });

  test("sends the model, messages and the headers signing depends on", async () => {
    const { inference, calls } = setup(ok);
    await inference.chat(messages);
    const { url, init } = calls[0] as Call;
    expect(url).toBe("https://ai.example/v1/chat/completions");
    expect(JSON.parse(Buffer.from(init?.body as Uint8Array).toString())).toEqual({
      model: "test-model",
      messages,
      max_tokens: 256,
    });
    expect(init?.headers).toMatchObject({
      authorization: "Bearer secret",
      "accept-encoding": "identity",
      "x-no-aliasing": "true",
    });
    expect(calls[1]?.url).toBe("https://ai.example/v1/signature/chat-1?signing_algo=ecdsa");
  });

  test("retries a signature that is not ready yet", async () => {
    const { inference, calls } = setup((url, attempt) =>
      url.includes("/signature/") && attempt < 3 ? new Response("", { status: 404 }) : ok(url),
    );
    expect((await inference.chat(messages)).verification.signature).toEqual(signature);
    expect(calls.filter((call) => call.url.includes("/signature/"))).toHaveLength(3);
  });

  test.each([
    ["never appears", () => new Response("", { status: 404 })],
    ["endpoint errors", () => new Response("", { status: 500 })],
    ["is reported unavailable in a 200", () => Response.json({ error_code: "x", message: "y" })],
    ["is missing fields", () => Response.json({ text: "only" })],
    ["request throws", () => Promise.reject(new Error("offline"))],
  ])("still returns the reply when the signature %s", async (_name, signatureResponse) => {
    const { inference } = setup((url) =>
      url.includes("/signature/") ? signatureResponse() : new Response(completion),
    );
    const result = await inference.chat(messages);
    expect(result.reply).toBe("meow");
    expect(result.verification.signature).toBeNull();
  });

  test("gives up with InferenceError when the provider does not answer in time", async () => {
    const { inference } = setup((_url, _attempt, signal) => hangUntilAborted(signal));
    await expect(inference.chat(messages)).rejects.toThrow(InferenceError);
  });

  test("throws InferenceError when the connection drops while reading the reply", async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    const { inference } = setup(() => new Response(broken));
    await expect(inference.chat(messages)).rejects.toThrow(InferenceError);
  });

  test("returns the reply without a signature when the signature request hangs", async () => {
    const { inference } = setup((url, _attempt, signal) =>
      url.includes("/signature/") ? hangUntilAborted(signal) : new Response(completion),
    );
    const result = await inference.chat(messages);
    expect(result.reply).toBe("meow");
    expect(result.verification.signature).toBeNull();
  });

  test.each([
    ["an HTTP error", () => new Response("busy", { status: 503 })],
    ["a body that is not JSON", () => new Response("<html>")],
    ["no choices", () => Response.json({ id: "chat-1", choices: [] })],
    ["an empty reply", () => Response.json({ id: "c", choices: [{ message: { content: "" } }] })],
    ["no id", () => Response.json({ choices: [{ message: { content: "meow" } }] })],
    ["a network failure", () => Promise.reject(new Error("offline"))],
  ])("throws InferenceError on %s", async (_name, response) => {
    const { inference } = setup(() => response());
    await expect(inference.chat(messages)).rejects.toThrow(InferenceError);
  });
});
