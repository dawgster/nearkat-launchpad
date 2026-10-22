import type { SignedMessage } from "near-kit";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { Auth } from "../src/auth.ts";
import { STARTER_PERSONALITY } from "../src/context.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { MemoryStore } from "../src/store.ts";
import { FakeChain, FakeInference, NEAR } from "./fakes.ts";

const keys = keysFromRootSecret(Buffer.alloc(32, 7));

async function setup() {
  const chain = new FakeChain();
  const inference = new FakeInference();
  const kats = new KatService({
    chain,
    store: new MemoryStore(),
    keys,
    inference,
    meter: new Meter(chain),
    prices: { chat: 2n * 10n ** 21n, save: 5n * 10n ** 22n },
    retryDelayMs: 0,
  });
  // Accepts any signature whose text is "valid".
  const auth = new Auth({
    sessionKey: keys.sessionKey(),
    recipient: "nearkat.xyz",
    verify: async (signed) => signed.signature === "valid",
  });
  const app = createApp({
    auth,
    kats,
    attestation: async () => ({ mode: "local" }),
    info: {
      chat_price: "2000000000000000000000",
      save_price: "50000000000000000000000",
      model: "m",
    },
    webOrigins: ["http://localhost:3000", "http://localhost:3001"],
  });
  chain.mint("1", "alice.near", NEAR);
  await kats.wakeNew();

  const signIn = async (accountId: string) => {
    const { nonce } = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const signed: SignedMessage = { accountId, publicKey: "ed25519:pk", signature: "valid" };
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({ nonce, signed_message: signed }),
    });
    return (await response.json()).token as string;
  };
  const as = (token: string, body?: unknown, method = "POST"): RequestInit => ({
    method,
    headers: { authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, chain, inference, signIn, as };
}

describe("keeper HTTP API", () => {
  test("serves the attestation without a session", async () => {
    const { app } = await setup();
    const response = await app.request("/attestation");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "local" });
  });

  test("publishes its prices and model without a session", async () => {
    const { app } = await setup();
    const response = await app.request("/info");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chat_price: "2000000000000000000000",
      save_price: "50000000000000000000000",
      model: "m",
    });
  });

  test("rejects a sign-in whose callback URL is not a string", async () => {
    const { app } = await setup();
    const { nonce } = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({
        nonce,
        callback_url: 5,
        signed_message: { accountId: "alice.near", publicKey: "ed25519:pk", signature: "valid" },
      }),
    });
    expect(response.status).toBe(400);
  });

  test("lets a signed-in owner read and chat with their kat, but not rewrite it", async () => {
    const { app, signIn, as } = await setup();
    const token = await signIn("alice.near");

    const context = await app.request("/kats/1/context", as(token, undefined, "GET"));
    expect(await context.json()).toMatchObject({
      personality: STARTER_PERSONALITY,
      memory_summary: "",
      version: 1,
    });

    // A kat's character grows from conversation; there is no route to write it.
    const written = await app.request(
      "/kats/1/personality",
      as(token, { prompt: "grumpy" }, "PUT"),
    );
    expect(written.status).toBe(404);

    const chat = await app.request("/kats/1/chat", as(token, { message: "hello" }));
    expect(chat.status).toBe(200);
    expect(await chat.json()).toMatchObject({
      reply: "reply 1",
      verification: { chat_id: "chat-1" },
    });
  });

  test.each([
    ["no token", {}],
    ["a made-up token", { authorization: "Bearer nope" }],
    ["a token without the Bearer scheme", { authorization: "nope" }],
  ])("answers 401 to a kat request with %s", async (_name, headers) => {
    const { app } = await setup();
    const response = await app.request("/kats/1/context", { headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
  });

  test("rejects a sign-in whose signature does not verify", async () => {
    const { app } = await setup();
    const { nonce } = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({
        nonce,
        signed_message: { accountId: "alice.near", publicKey: "ed25519:pk", signature: "forged" },
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_signature" });
  });

  test.each([
    ["no body", undefined],
    ["a body that is not JSON", "{"],
    ["a JSON array", "[]"],
    ["no signed message", JSON.stringify({ nonce: "abc" })],
    ["a signed message with no account", JSON.stringify({ nonce: "abc", signed_message: {} })],
  ])("answers 400 to a sign-in with %s", async (_name, body) => {
    const { app } = await setup();
    const response = await app.request("/auth/session", { method: "POST", body });
    expect(response.status).toBe(400);
  });

  test("answers 413 to a request body larger than 16 KB", async () => {
    const { app } = await setup();
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({ nonce: "x".repeat(20_000) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "too_large" });
  });

  test("answers unknown routes in the same JSON shape", async () => {
    const { app } = await setup();
    const response = await app.request("/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found" });
  });

  test("answers 403 when a signed-in account does not own the kat", async () => {
    const { app, signIn, as } = await setup();
    const response = await app.request(
      "/kats/1/context",
      as(await signIn("bob.near"), undefined, "GET"),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_owner" });
  });

  test("answers 402 with the balance when the kat cannot pay", async () => {
    const { app, chain, signIn, as } = await setup();
    (chain.kats.get("1") as { balance: string }).balance = "5";
    const response = await app.request(
      "/kats/1/chat",
      as(await signIn("alice.near"), { message: "hello" }),
    );
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: "insufficient_balance",
      balance: "5",
      required: "2000000000000000000000",
    });
  });

  test("answers 503 when the model is down", async () => {
    const { app, inference, signIn, as } = await setup();
    inference.down = true;
    const response = await app.request(
      "/kats/1/chat",
      as(await signIn("alice.near"), { message: "hello" }),
    );
    expect(response.status).toBe(503);
  });

  test("answers 500 'corrupted' when the stored context fails its hash check", async () => {
    const { app, chain, signIn, as } = await setup();
    (chain.kats.get("1") as { context_hash: string }).context_hash =
      Buffer.alloc(32).toString("base64");
    const response = await app.request(
      "/kats/1/chat",
      as(await signIn("alice.near"), { message: "hello" }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "corrupted" });
  });

  test.each([
    ["a missing message", {}],
    ["a message that is a number", { message: 5 }],
  ])("answers 400 to a chat with %s", async (_name, body) => {
    const { app, signIn, as } = await setup();
    const response = await app.request("/kats/1/chat", as(await signIn("alice.near"), body));
    expect(response.status).toBe(400);
  });

  test("allows the web app's origin and no other", async () => {
    const { app } = await setup();
    const allowed = await app.request("/attestation", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const second = await app.request("/attestation", {
      headers: { origin: "http://localhost:3001" },
    });
    expect(second.headers.get("access-control-allow-origin")).toBe("http://localhost:3001");
    const other = await app.request("/attestation", {
      headers: { origin: "https://evil.example" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("collections served alongside the home one", () => {
  async function setupMany() {
    const home = await setup();
    const chain = new FakeChain();
    chain.collection = {
      name: "Magister",
      prompt: "You are {name} #{token_id}, a tutor.",
      starter: "No student yet.",
      tee: null,
    };
    const tutor = new KatService({
      chain,
      store: new MemoryStore(),
      keys: keys.forContract("tutor.near"),
      inference: home.inference,
      meter: new Meter(chain),
      prices: { chat: 2n * 10n ** 21n, save: 5n * 10n ** 22n },
      collection: chain.collection,
      retryDelayMs: 0,
    });
    chain.mint("1", "alice.near", NEAR);
    await tutor.wakeNew();
    const auth = new Auth({
      sessionKey: keys.sessionKey(),
      recipient: "nearkat.xyz",
      verify: async (signed) => signed.signature === "valid",
    });
    const app = createApp({
      auth,
      homeContractId: "nearkat.near",
      collection: (id) => (id === "tutor.near" ? tutor : undefined),
      collections: () => ({ served: ["tutor.near"] }),
      attestation: async () => ({ mode: "local" }),
      info: { chat_price: "1", save_price: "1", model: "m" },
      webOrigins: [],
    });
    const signIn = async (accountId: string) => {
      const { nonce } = await (await app.request("/auth/challenge", { method: "POST" })).json();
      const signed: SignedMessage = { accountId, publicKey: "ed25519:pk", signature: "valid" };
      const response = await app.request("/auth/session", {
        method: "POST",
        body: JSON.stringify({ nonce, signed_message: signed }),
      });
      return (await response.json()).token as string;
    };
    return { app, signIn, as: home.as };
  }

  test("reads and talks to a token of another collection under /c/:contract", async () => {
    const { app, signIn, as } = await setupMany();
    const token = await signIn("alice.near");
    const context = await app.request("/c/tutor.near/kats/1/context", as(token, undefined, "GET"));
    expect(await context.json()).toMatchObject({ personality: "No student yet." });
    const chat = await app.request("/c/tutor.near/kats/1/chat", as(token, { message: "salve" }));
    expect(chat.status).toBe(200);
  });

  test("says which collections it doesn't serve", async () => {
    const { app, signIn, as } = await setupMany();
    const token = await signIn("alice.near");
    const response = await app.request(
      "/c/unknown.near/kats/1/context",
      as(token, undefined, "GET"),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_served" });
  });

  test("asks for a session on scoped routes too", async () => {
    const { app } = await setupMany();
    const response = await app.request("/c/tutor.near/kats/1/context");
    expect(response.status).toBe(401);
  });

  test("says it is starting up while the home collection isn't served yet", async () => {
    const { app, signIn, as } = await setupMany();
    const token = await signIn("alice.near");
    const response = await app.request("/kats/1/context", as(token, undefined, "GET"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "waking_up" });
  });

  test("lists what it serves", async () => {
    const { app } = await setupMany();
    expect(await (await app.request("/collections")).json()).toEqual({ served: ["tutor.near"] });
  });
});

describe("art", () => {
  test("serves a token's picture as SVG to anyone", async () => {
    const auth = new Auth({
      sessionKey: keys.sessionKey(),
      recipient: "x",
      verify: async () => true,
    });
    const app = createApp({
      auth,
      art: async (contract, token) =>
        contract === "tutor.near" && token === "1" ? "<svg>tutor 1</svg>" : null,
      attestation: async () => ({ mode: "local" }),
      info: { chat_price: "1", save_price: "1", model: "m" },
      webOrigins: ["http://localhost:3000"],
    });
    const response = await app.request("/art/tutor.near/1.svg", {
      headers: { origin: "https://marketplace.example" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe("<svg>tutor 1</svg>");

    expect((await app.request("/art/tutor.near/2.svg")).status).toBe(404);
    expect((await app.request("/art/tutor.near/1.png")).status).toBe(404);
    // Only the art is open to every origin.
    const info = await app.request("/info", { headers: { origin: "https://marketplace.example" } });
    expect(info.headers.get("access-control-allow-origin")).toBeNull();
  });
});
