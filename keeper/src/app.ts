import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SignedMessage } from "near-kit";
import type { Auth } from "./auth.ts";
import { CorruptContextError, HttpError } from "./errors.ts";
import type { KatService } from "./kats.ts";

export interface AppOptions {
  auth: Auth;
  kats: KatService;
  /** Served at GET /attestation. */
  attestation: () => Promise<Record<string, unknown>>;
  /** Origin of the web app, for CORS. */
  webOrigin: string;
}

type Env = { Variables: { accountId: string } };

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new HttpError(400, "invalid_input", "Request body must be a JSON object");
}

export function createApp(options: AppOptions): Hono<Env> {
  const { auth, kats } = options;
  const app = new Hono<Env>();

  app.use(
    "*",
    cors({ origin: options.webOrigin, allowHeaders: ["authorization", "content-type"] }),
  );

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json(
        { error: error.code, message: error.message, ...error.extra },
        error.status as ContentfulStatusCode,
      );
    }
    if (error instanceof CorruptContextError) {
      return c.json({ error: "corrupted", message: error.message }, 500);
    }
    console.error(error);
    return c.json({ error: "internal", message: "Internal error" }, 500);
  });

  app.get("/attestation", async (c) => c.json(await options.attestation()));

  app.post("/auth/challenge", (c) => c.json(auth.challenge()));

  app.post("/auth/session", async (c) => {
    const body = await jsonBody(c.req.raw);
    const signed = body.signed_message as SignedMessage | undefined;
    if (
      typeof body.nonce !== "string" ||
      !signed ||
      typeof signed.accountId !== "string" ||
      typeof signed.publicKey !== "string" ||
      typeof signed.signature !== "string"
    ) {
      throw new HttpError(400, "invalid_input", "nonce and signed_message are required");
    }
    return c.json(await auth.createSession(signed, body.nonce));
  });

  app.use("/kats/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const accountId = header.startsWith("Bearer ") ? auth.verifySession(header.slice(7)) : null;
    if (!accountId) {
      throw new HttpError(401, "unauthorized", "A valid session token is required");
    }
    c.set("accountId", accountId);
    await next();
  });

  app.get("/kats/:id/context", async (c) =>
    c.json(await kats.getContext(c.get("accountId"), c.req.param("id"))),
  );

  app.put("/kats/:id/personality", async (c) => {
    const body = await jsonBody(c.req.raw);
    return c.json(
      await kats.setPersonality(c.get("accountId"), c.req.param("id"), body.prompt as string),
    );
  });

  app.post("/kats/:id/chat", async (c) => {
    const body = await jsonBody(c.req.raw);
    return c.json(await kats.chat(c.get("accountId"), c.req.param("id"), body.message as string));
  });

  return app;
}
