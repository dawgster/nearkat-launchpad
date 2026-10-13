/** A kat's context as its owner sees it. */
export interface ContextDoc {
  token_id: string;
  version: number;
  salt: string;
  personality: string;
  memory_summary: string;
}

export interface SignatureInfo {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind: string;
}

export interface Verification {
  chat_id: string;
  model: string;
  request_hash: string;
  response_hash: string;
  signature: SignatureInfo | null;
}

export interface ChatReply {
  reply: string;
  verification: Verification;
  /** The kat's balance in yoctoNEAR after this message. */
  balance: string;
}

export interface Session {
  token: string;
  account_id: string;
  expires_at: number;
}

/** A NEP-413 signature as wallets return it. */
export interface SignedMessage {
  accountId: string;
  publicKey: string;
  signature: string;
}

/** An error response from the keeper, or a failure to reach it at all. */
export class KeeperError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export interface Keeper {
  attestation(): Promise<Record<string, unknown>>;
  challenge(): Promise<{ nonce: string; message: string; recipient: string }>;
  createSession(nonce: string, signed: SignedMessage): Promise<Session>;
  getContext(token: string, tokenId: string): Promise<ContextDoc>;
  setPersonality(token: string, tokenId: string, prompt: string): Promise<ContextDoc>;
  chat(token: string, tokenId: string, message: string): Promise<ChatReply>;
}

export function createKeeper(baseUrl: string, fetchImpl: typeof fetch = fetch): Keeper {
  async function request<T>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new KeeperError(0, "unreachable", "Cannot reach the keeper. Check your connection.");
    }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const { error, message, ...extra } = (data ?? {}) as Record<string, unknown>;
      throw new KeeperError(
        response.status,
        typeof error === "string" ? error : "unknown",
        typeof message === "string" ? message : `The keeper answered ${response.status}`,
        extra,
      );
    }
    return data as T;
  }

  const kat = (tokenId: string) => `/kats/${encodeURIComponent(tokenId)}`;
  return {
    attestation: () => request("GET", "/attestation"),
    challenge: () => request("POST", "/auth/challenge"),
    createSession: (nonce, signed) =>
      request("POST", "/auth/session", { body: { nonce, signed_message: signed } }),
    getContext: (token, tokenId) => request("GET", `${kat(tokenId)}/context`, { token }),
    setPersonality: (token, tokenId, prompt) =>
      request("PUT", `${kat(tokenId)}/personality`, { token, body: { prompt } }),
    chat: (token, tokenId, message) =>
      request("POST", `${kat(tokenId)}/chat`, { token, body: { message } }),
  };
}
