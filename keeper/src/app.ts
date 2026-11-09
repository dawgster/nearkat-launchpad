import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SignedMessage } from "near-kit";
import type { Auth } from "./auth.ts";
import { CorruptContextError, HttpError } from "./errors.ts";
import { type Ingest, MAX_SAMPLES_PER_CALL, MAX_SEALED_CHARS } from "./ingest.ts";
import type { KatService } from "./kats.ts";
import { RateLimiter } from "./ratelimit.ts";
import { IMPORT_INFO, type SealingKey } from "./sealing.ts";

export interface AppOptions {
  auth: Auth;
  /** The home collection, served at /kats. Absent until it can be served. */
  kats?: KatService;
  /** Otherwise /kats serves this collection through `collection`. */
  homeContractId?: string;
  /** Any collection this keeper serves, by contract id, served at /c/:contract/kats. */
  collection?: (contractId: string) => KatService | undefined;
  /**
   * A token's picture as SVG, for wallets and marketplaces: collections point
   * their `base_uri` at /art/<contract>/. Null when there is no such token.
   */
  art?: (contractId: string, tokenId: string) => Promise<string | null>;
  /** A dataset collection's ingest, served at POST /c/:contract/samples. */
  ingest?: (contractId: string) => Ingest | undefined;
  /** Whether a served collection is a dataset: its samples can't be talked to. */
  isDataset?: (contractId: string) => boolean;
  /** Served at GET /collections: what this keeper serves, and what it is waiting on. */
  collections?: () => Record<string, unknown>;
  /** Served at GET /attestation. */
  attestation: () => Promise<Record<string, unknown>>;
  /** Served at GET /info: what the web app needs to quote costs. Amounts are yoctoNEAR. */
  info: { chat_price: string; save_price: string; model: string };
  /** Opens chat histories owners seal in their browser for import. */
  sealing?: SealingKey;
  /** Origins the web app is served from, for CORS. */
  webOrigins: string[];
  /**
   * Per-account limits on chat messages and on reading minds, and a
   * per-client limit on sign-in requests. Defaults: 20 messages at once, then
   * one every 3 seconds; 30 reads, then one a second; 30 sign-in requests,
   * then one every 2 seconds.
   */
  limits?: {
    chat: RateLimiter;
    read?: RateLimiter;
    auth: RateLimiter;
    import?: RateLimiter;
    ingest?: RateLimiter;
  };
  /**
   * Behind one reverse proxy, the client is the address that proxy appended:
   * the last in X-Forwarded-For. Earlier entries are whatever the client sent.
   */
  trustProxy?: boolean;
}

type Env = { Variables: { accountId: string } };

/** Largest accepted request body; the biggest legitimate one is a 4,000-character prompt. */
const MAX_BODY_BYTES = 16 * 1024;
/** A sealed history import: 120,000 characters, mostly ASCII, sealed and base64-encoded. */
const MAX_IMPORT_BYTES = 768 * 1024;
/** A batch of sealed samples: at most 25, each up to 180,000 characters, plus JSON around them. */
const MAX_SAMPLES_BYTES = MAX_SAMPLES_PER_CALL * (MAX_SEALED_CHARS + 100) + 1024;
const isImport = (path: string) => path.endsWith("/import");
const isSamples = (path: string) => path.endsWith("/samples");

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
  const limits = {
    chat: options.limits?.chat ?? new RateLimiter({ burst: 20, refillMs: 3_000 }),
    read: options.limits?.read ?? new RateLimiter({ burst: 30, refillMs: 1_000 }),
    auth: options.limits?.auth ?? new RateLimiter({ burst: 30, refillMs: 2_000 }),
    import: options.limits?.import ?? new RateLimiter({ burst: 3, refillMs: 60_000 }),
    ingest: options.limits?.ingest ?? new RateLimiter({ burst: 20, refillMs: 2_000 }),
  };
  const limit = (limiter: RateLimiter, key: string) => {
    const waitMs = limiter.take(key);
    if (waitMs > 0) {
      throw new HttpError(429, "rate_limited", "Too many requests; slow down", {
        retry_after_ms: waitMs,
      });
    }
  };
  const clientOf = (c: Context<Env>): string => {
    if (options.trustProxy) {
      const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
      if (forwarded) {
        return forwarded;
      }
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };

  // Art is public, and fetched by wallets and marketplaces from anywhere;
  // everything else answers only the web app.
  const publicCors = cors({ origin: "*" });
  const appCors = cors({
    origin: options.webOrigins,
    allowHeaders: ["authorization", "content-type"],
  });
  app.use("*", (c, next) => (c.req.path.startsWith("/art/") ? publicCors : appCors)(c, next));

  const tooLarge = () => {
    throw new HttpError(413, "too_large", "Request body is too large");
  };
  const smallBodies = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
  const importBodies = bodyLimit({ maxSize: MAX_IMPORT_BYTES, onError: tooLarge });
  const sampleBodies = bodyLimit({ maxSize: MAX_SAMPLES_BYTES, onError: tooLarge });
  app.use("*", (c, next) =>
    (isSamples(c.req.path) ? sampleBodies : isImport(c.req.path) ? importBodies : smallBodies)(
      c,
      next,
    ),
  );

  // After CORS, so a refusal still carries the headers the browser needs to
  // read it; preflights are free.
  app.use("/auth/*", async (c, next) => {
    if (c.req.method !== "OPTIONS") {
      limit(limits.auth, clientOf(c));
    }
    await next();
  });

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

  app.get("/art/:contract/:file", async (c) => {
    const match = /^(\d{1,20})\.svg$/.exec(c.req.param("file"));
    const svg = match?.[1] ? await options.art?.(c.req.param("contract"), match[1]) : null;
    if (!svg) {
      throw new HttpError(404, "not_found", "No such token");
    }
    return c.body(svg, 200, {
      "content-type": "image/svg+xml",
      // A token's picture changes as it grows, so caches check back hourly.
      "cache-control": "public, max-age=3600",
    });
  });

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
  app.use("/c/:contract/samples", signedIn);

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

  /** Datasets hold pictures, not minds: nothing to chat with, read, export or teach. */
  const talkable = (contractId: string | undefined): KatService => {
    const service = serving(contractId);
    if (options.isDataset?.(contractId ?? options.homeContractId ?? "")) {
      throw new HttpError(409, "not_talkable", "Samples can't be talked to");
    }
    return service;
  };

  app.post("/c/:contract/samples", async (c) => {
    const contract = c.req.param("contract");
    const ingest = options.ingest?.(contract);
    if (!ingest) {
      if (!options.collection?.(contract)) {
        throw new HttpError(404, "not_served", `This keeper does not serve ${contract}`);
      }
      throw new HttpError(409, "not_a_dataset", "This is not a dataset collection");
    }
    limit(limits.ingest, c.get("accountId"));
    const body = await jsonBody(c.req.raw);
    if (!Array.isArray(body.samples)) {
      throw new HttpError(400, "invalid_input", "samples must be a list");
    }
    return c.json(
      await ingest.seal(
        c.get("accountId"),
        body.samples as Array<{ token_id: string; sealed: string }>,
      ),
    );
  });

  for (const prefix of ["", "/c/:contract"]) {
    app.get(`${prefix}/kats/:id/context`, async (c) => {
      limit(limits.read, c.get("accountId"));
      return c.json(
        await talkable(c.req.param("contract")).getContext(c.get("accountId"), c.req.param("id")),
      );
    });

    app.get(`${prefix}/kats/:id/export`, async (c) => {
      limit(limits.read, c.get("accountId"));
      const mind = await talkable(c.req.param("contract")).exportMind(
        c.get("accountId"),
        c.req.param("id"),
      );
      return c.json(
        { ...mind, collection: c.req.param("contract") ?? options.homeContractId ?? null },
        200,
        { "content-disposition": `attachment; filename="mind-${mind.token_id}.json"` },
      );
    });

    app.post(`${prefix}/kats/:id/import`, async (c) => {
      const kats = talkable(c.req.param("contract"));
      limit(limits.import, c.get("accountId"));
      const body = await jsonBody(c.req.raw);
      if (!options.sealing || typeof body.sealed !== "string") {
        throw new HttpError(400, "invalid_input", "Send the history sealed to this keeper's key");
      }
      let history: { source?: unknown; messages?: unknown };
      try {
        history = JSON.parse(options.sealing.open(body.sealed, IMPORT_INFO));
      } catch {
        throw new HttpError(
          400,
          "invalid_input",
          "The history couldn't be opened: it must be sealed to this keeper's key",
        );
      }
      return c.json(
        await kats.importHistory(
          c.get("accountId"),
          c.req.param("id"),
          history.messages,
          typeof history.source === "string" ? history.source : "",
        ),
      );
    });

    app.post(`${prefix}/kats/:id/chat`, async (c) => {
      limit(limits.chat, c.get("accountId"));
      const body = await jsonBody(c.req.raw);
      return c.json(
        await talkable(c.req.param("contract")).chat(
          c.get("accountId"),
          c.req.param("id"),
          body.message as string,
        ),
      );
    });
  }

  return app;
}
