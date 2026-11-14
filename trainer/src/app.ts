import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SignedMessage } from "near-kit";
import type { Auth } from "../../keeper/src/auth.ts";
import { HttpError } from "../../keeper/src/errors.ts";
import { RateLimiter } from "../../keeper/src/ratelimit.ts";
import { BadRequest, MIN_RUN_SAMPLES, type RunState, type Runs } from "./run.ts";

export interface AppOptions {
  auth: Auth;
  runs: Runs;
  /** Served at GET /attestation. */
  attestation: () => Promise<Record<string, unknown>>;
  /** Served at GET /info. */
  info: { app_id: string; label: string; classes_supported: "any"; heldout: number };
  /** Origins the web app is served from, for CORS. */
  webOrigins: string[];
  limits?: { auth: RateLimiter; train: RateLimiter; open?: RateLimiter };
  /** Behind one reverse proxy, the client is the last address in X-Forwarded-For. */
  trustProxy?: boolean;
}

type Env = { Variables: { accountId: string } };

/** 200 token ids of up to 64 characters, and JSON around them. */
const MAX_BODY_BYTES = 32 * 1024;
const MAX_ID_LENGTH = 64;
/** A model token's id: `model-`, then a run id of up to 64 characters. */
const MAX_TOKEN_ID_LENGTH = 70;

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

/** A run as the web sees it: the RunState fields and nothing else. */
function publicRun(run: RunState): RunState {
  return {
    id: run.id,
    contract: run.contract,
    renter: run.renter,
    tokenIds: run.tokenIds,
    stage: run.stage,
    ...(run.epoch !== undefined && { epoch: run.epoch }),
    ...(run.epochs !== undefined && { epochs: run.epochs }),
    ...(run.accuracy !== undefined && { accuracy: run.accuracy }),
    ...(run.modelSha256 !== undefined && { modelSha256: run.modelSha256 }),
    ...(run.recordedTokens !== undefined && { recordedTokens: run.recordedTokens }),
    ...(run.recordTx !== undefined && { recordTx: run.recordTx }),
    ...(run.partial !== undefined && { partial: run.partial }),
    ...(run.modelToken !== undefined && { modelToken: run.modelToken }),
    ...(run.mintTx !== undefined && { mintTx: run.mintTx }),
    ...(run.mintProblem !== undefined && { mintProblem: run.mintProblem }),
    ...(run.error !== undefined && { error: run.error }),
  };
}

export function createApp(options: AppOptions): Hono<Env> {
  const { auth, runs } = options;
  const app = new Hono<Env>();
  const limits = {
    auth: options.limits?.auth ?? new RateLimiter({ burst: 30, refillMs: 2_000 }),
    train: options.limits?.train ?? new RateLimiter({ burst: 5, refillMs: 10_000 }),
    // Opening a model costs an MPC request and a rebuild.
    open: options.limits?.open ?? new RateLimiter({ burst: 5, refillMs: 10_000 }),
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
    // Never the error itself: it could carry what a sample's path or Python said.
    console.error(`Request failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return c.json({ error: "internal", message: "Internal error" }, 500);
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
  app.use("/train", signedIn);
  app.use("/runs/:id/model", signedIn);
  app.use("/models/*", signedIn);

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

  app.post("/train", async (c) => {
    const body = await jsonBody(c.req.raw);
    const ids = body.token_ids;
    if (
      typeof body.contract !== "string" ||
      body.contract.length < 2 ||
      body.contract.length > MAX_ID_LENGTH ||
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH)
    ) {
      throw new BadRequest("contract and a non-empty list of token_ids are required");
    }
    // Refused before any key is asked for: train.py can't train on fewer.
    if (ids.length < MIN_RUN_SAMPLES) {
      throw new BadRequest(`Train on at least ${MIN_RUN_SAMPLES} samples`);
    }
    // Charged only for a well-formed request: a malformed one costs nothing to refuse.
    limit(limits.train, c.get("accountId"));
    const run = await runs.start(body.contract, c.get("accountId"), ids as string[]);
    return c.json(publicRun(run), 202);
  });

  // Public: it holds no image data and no keys.
  app.get("/runs/:id", (c) => {
    const run = runs.get(c.req.param("id"));
    if (!run) {
      throw new HttpError(404, "not_found", "No such run");
    }
    return c.json(publicRun(run));
  });

  app.get("/runs/:id/model", (c) => {
    const id = c.req.param("id");
    const model = runs.model(id, c.get("accountId"));
    return c.body(new Uint8Array(model), 200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${id}.onnx"`,
      "cache-control": "no-store",
    });
  });

  // The model a token stands for, for whoever owns the token now.
  app.get("/models/:contract/:token", async (c) => {
    const contract = c.req.param("contract");
    const token = c.req.param("token");
    if (
      contract.length < 2 ||
      contract.length > MAX_ID_LENGTH ||
      token.length === 0 ||
      token.length > MAX_TOKEN_ID_LENGTH
    ) {
      throw new BadRequest("A contract and a model token are required");
    }
    limit(limits.open, c.get("accountId"));
    const model = await runs.tokenModel(contract, token, c.get("accountId"));
    return c.body(new Uint8Array(model), 200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${token}.onnx"`,
      "cache-control": "no-store",
    });
  });

  return app;
}
