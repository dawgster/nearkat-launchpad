import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
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
  /** Served at GET /info: what the web app needs to quote costs. Amounts are yoctoNEAR. */
  info: { chat_price: string; save_price: string; model: string };
  /** Origins the web app is served from, for CORS. */
  webOrigins: string[];
}

type Env = { Variables: { accountId: string } };

/** Largest accepted request body; the biggest legitimate one is a 4,000-character prompt. */
const MAX_BODY_BYTES = 16 * 1024;

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
    cors({ origin: options.webOrigins, allowHeaders: ["authorization", "content-type"] }),
  );

  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new HttpError(413, "too_large", "Request body is too large");
      },
    }),
  );

  app.notFound((c) => c.json({ error: "not_found", message: "No such route" }, 404));

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

  app.get("/info", (c) => c.json(options.info));

  app.post("/auth/challenge", (c) => c.json(auth.challenge()));

  app.post("/auth/session", async (c) => {
    const body = await jsonBody(c.req.raw);
    const signed = body.signed_message as SignedMessage | undefined;
    if (
      typeof body.nonce !== "string" ||
      !signed ||
      typeof signed.accountId !== "string" ||
      typeof signed.publicKey !== "string" ||
      typeof signed.signature !== "string" ||
      (body.callback_url !== undefined && typeof body.callback_url !== "string")
    ) {
      throw new HttpError(400, "invalid_input", "nonce and signed_message are required");
    }
    return c.json(await auth.createSession(signed, body.nonce, body.callback_url));
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
