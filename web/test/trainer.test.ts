import { expect, test, vi } from "vitest";
import { KeeperError } from "../src/lib/keeper.ts";
import { KeeperSession } from "../src/lib/session.ts";
import { createTrainer, type TokenSession } from "../src/lib/trainer.ts";

const session: TokenSession = { call: (run) => run("tok") };

test("starts a run with the session's token, and reads it back", async () => {
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/train")) {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe(
        "Bearer tok",
      );
      expect(JSON.parse(init?.body as string)).toEqual({ contract: "c.near", token_ids: ["1"] });
      return Response.json({ id: "run-1", stage: "checking" }, { status: 202 });
    }
    return Response.json({ id: "run-1", stage: "done" });
  });
  const trainer = createTrainer("http://t.example/", fetchImpl as unknown as typeof fetch);
  expect((await trainer.train(session, "c.near", ["1"])).id).toBe("run-1");
  expect((await trainer.run("run-1")).stage).toBe("done");
  expect(fetchImpl.mock.calls[1]?.[0]).toBe("http://t.example/runs/run-1");
});

test("passes on the training app's reason for refusing", async () => {
  const fetchImpl = async () =>
    Response.json({ error: "bad_request", message: "Sample 3: already used" }, { status: 400 });
  const trainer = createTrainer("http://t.example", fetchImpl as unknown as typeof fetch);
  const refused = trainer.train(session, "c.near", ["3"]);
  await expect(refused).rejects.toBeInstanceOf(KeeperError);
  await expect(refused).rejects.toThrow("Sample 3: already used");
});

test("downloads the model's bytes", async () => {
  const fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]));
  const trainer = createTrainer("http://t.example", fetchImpl as unknown as typeof fetch);
  expect(await trainer.model(session, "run-1")).toEqual(new Uint8Array([1, 2, 3]));
});

test("a rejected token signs the renter in again and the run starts on the second try", async () => {
  sessionStorage.clear();
  let issued = 0;
  const signIn = {
    challenge: async () => ({ nonce: btoa("n".repeat(32)), message: "Sign in", recipient: "r" }),
    createSession: async (_nonce: string, signed: { accountId: string }) => {
      issued += 1;
      return {
        token: `token-${issued}`,
        account_id: signed.accountId,
        expires_at: Date.now() + 900_000,
      };
    },
  };
  const session = new KeeperSession({
    keeper: signIn as never,
    accountId: "alice.near",
    signMessage: async () => ({ accountId: "alice.near", publicKey: "ed25519:pk", signature: "s" }),
    expect: { message: "Sign in", recipient: "r" },
    scope: "trainer.test:",
  });
  const tokens: string[] = [];
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const bearer = String((init?.headers as Record<string, string> | undefined)?.authorization);
    tokens.push(bearer);
    return bearer === "Bearer token-1"
      ? Response.json({ error: "unauthorized", message: "expired" }, { status: 401 })
      : Response.json({ id: "run-1", stage: "checking" }, { status: 202 });
  };
  const trainer = createTrainer("http://t.example", fetchImpl as unknown as typeof fetch);
  expect((await trainer.train(session, "c.near", ["1"])).id).toBe("run-1");
  expect(tokens).toEqual(["Bearer token-1", "Bearer token-2"]);
  sessionStorage.clear();
});
