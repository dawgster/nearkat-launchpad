import { KeeperError, type Session, type SignedMessage } from "./keeper.ts";

/** The fewest samples a training app trains on: it refuses a run on fewer. */
export const MIN_TRAIN_SAMPLES = 2;

export type Stage =
  | "checking"
  | "keys"
  | "loading"
  | "training"
  | "recording"
  | "minting"
  | "done"
  | "failed";

/** A training run as the training app reports it. It never holds samples or keys. */
export interface RunState {
  id: string;
  contract: string;
  renter: string;
  tokenIds: string[];
  stage: Stage;
  epoch?: number;
  epochs?: number;
  /** Held-out accuracy, 0 to 1, as the training app measured it. */
  accuracy?: number;
  modelSha256?: string;
  /** How many samples the run is recorded on-chain for; set when done. */
  recordedTokens?: number;
  /** The first transaction that recorded the run, when the app knows it. */
  recordTx?: string;
  /** Set when only part of the run could be recorded; says why. */
  partial?: string;
  /** The token the model was minted as, to the renter, once the run is done. */
  modelToken?: string;
  /** The transaction that minted it, when the app knows it. */
  mintTx?: string;
  /** Set instead of `modelToken` when the run is done but its model couldn't be minted; says why. */
  mintProblem?: string;
  error?: string;
}

export interface TrainerAttestation {
  mode: "local" | "phala";
  app_id: string;
  /** The NEAR key the app signs its on-chain records with. */
  public_key: string;
  seal_public_key: string;
  quote?: string;
  compose_hash?: string;
}

export interface TrainerInfo {
  app_id: string;
  label: string;
  classes_supported: "any";
  /** How many held-out images the app scores its models on. */
  heldout: number;
}

/** What a trainer call needs from a signed-in session. */
export interface TokenSession {
  call<T>(run: (token: string) => Promise<T>): Promise<T>;
}

/** A training app this deployment knows the address of, and the account's sign-in to it. */
export interface TrainerAccess {
  trainer: Trainer;
  /** Signs in to this trainer: one message for the wallet, kept for the tab. */
  session: TokenSession;
}

export interface Trainer {
  attestation(): Promise<TrainerAttestation>;
  info(): Promise<TrainerInfo>;
  /** Sign-in, the keeper's way: a `KeeperSession` drives these. */
  challenge(): Promise<{ nonce: string; message: string; recipient: string }>;
  createSession(nonce: string, signed: SignedMessage, callbackUrl?: string): Promise<Session>;
  /** Starts a run on rented samples. Refused with the reason when a sample can't be used. */
  train(session: TokenSession, contract: string, tokenIds: string[]): Promise<RunState>;
  run(id: string): Promise<RunState>;
  /** The trained model's ONNX bytes; only for the renter, once the run is done. */
  model(session: TokenSession, id: string): Promise<Uint8Array>;
  /**
   * A model token's ONNX bytes, put together again from its sealed weights;
   * only for the token's owner, and only from the app that trained it. The
   * app asks NEAR's MPC network for the key first, so this takes a while.
   */
  tokenModel(session: TokenSession, contract: string, tokenId: string): Promise<Uint8Array>;
}

/** A client for a training app. Errors are `KeeperError`s, so a session renews on a 401. */
export function createTrainer(baseUrl: string, fetchImpl: typeof fetch = fetch): Trainer {
  const root = baseUrl.replace(/\/+$/, "");

  async function send(
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers: {
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new KeeperError(0, "unreachable", "Cannot reach the training app.");
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const { error, message, ...extra } = data ?? {};
      throw new KeeperError(
        response.status,
        typeof error === "string" ? error : "unknown",
        typeof message === "string" ? message : `The training app answered ${response.status}`,
        extra,
      );
    }
    return response;
  }

  const json = async <T>(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown },
  ): Promise<T> => (await send(method, path, options)).json() as Promise<T>;

  return {
    attestation: () => json("GET", "/attestation"),
    info: () => json("GET", "/info"),
    challenge: () => json("POST", "/auth/challenge"),
    createSession: (nonce, signed, callbackUrl) =>
      json("POST", "/auth/session", {
        body: { nonce, signed_message: signed, callback_url: callbackUrl },
      }),
    train: (session, contract, tokenIds) =>
      session.call((token) =>
        json<RunState>("POST", "/train", { token, body: { contract, token_ids: tokenIds } }),
      ),
    run: (id) => json("GET", `/runs/${encodeURIComponent(id)}`),
    model: (session, id) =>
      session.call(async (token) => {
        const response = await send("GET", `/runs/${encodeURIComponent(id)}/model`, { token });
        return new Uint8Array(await response.arrayBuffer());
      }),
    tokenModel: (session, contract, tokenId) =>
      session.call(async (token) => {
        const response = await send(
          "GET",
          `/models/${encodeURIComponent(contract)}/${encodeURIComponent(tokenId)}`,
          { token },
        );
        return new Uint8Array(await response.arrayBuffer());
      }),
  };
}
