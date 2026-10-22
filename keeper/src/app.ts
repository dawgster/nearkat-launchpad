import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SignedMessage } from "near-kit";
import type { Auth } from "./auth.ts";
import { CorruptContextError, HttpError } from "./errors.ts";
import type { KatService } from "./kats.ts";

export interface AppOptions {
  auth: Auth;
  /** The home collection, served at /kats. Absent until it can be served. */
  kats?: KatService;
  /** Otherwise /kats serves this collection through `collection`. */
  homeContractId?: string;
  /** Any collection this keeper serves, by contract id, served at /c/:contract/kats. */
  collection?: (contractId: string) => KatService | undefined;
  /** Served at GET /collections: what this keeper serves, and what it is waiting on. */
  collections?: () => Record<string, unknown>;
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

  app.get("/collections", (c) => c.json(options.collections?.() ?? {}));

  const signedIn = createMiddleware<Env>(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const accountId = header.startsWith("Bearer ") ? auth.verifySession(header.slice(7)) : null;
    if (!accountId) {
      throw new HttpError(401, "unauthorized", "A valid session token is required");
    }
    c.set("accountId", accountId);
    await next();
  });
  app.use("/kats/*", signedIn);
  app.use("/c/:contract/kats/*", signedIn);

  /** The collection a request is for: the home one, or the one in the path. */
  const serving = (contractId: string | undefined): KatService => {
    if (contractId === undefined) {
      const home =
        kats ?? (options.homeContractId ? options.collection?.(options.homeContractId) : undefined);
      if (!home) {
        // The web app waits on this code, as it does for a kat that is waking.
        throw new HttpError(409, "waking_up", "The keeper is still starting up");
      }
      return home;
    }
    const scoped = options.collection?.(contractId);
    if (!scoped) {
      throw new HttpError(404, "not_served", `This keeper does not serve ${contractId}`);
    }
    return scoped;
  };

  for (const prefix of ["", "/c/:contract"]) {
    app.get(`${prefix}/kats/:id/context`, async (c) =>
      c.json(
        await serving(c.req.param("contract")).getContext(c.get("accountId"), c.req.param("id")),
      ),
    );

    app.post(`${prefix}/kats/:id/chat`, async (c) => {
      const body = await jsonBody(c.req.raw);
      return c.json(
        await serving(c.req.param("contract")).chat(
          c.get("accountId"),
          c.req.param("id"),
          body.message as string,
        ),
      );
    });
  }

  return app;
}
