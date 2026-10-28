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
  /** Set when the model's reply quoted the collection's secret instructions and was replaced. */
  withheld?: boolean;
  /** Set when the token's mind tried to pay from its wallet. */
  payment?: PaymentOutcome;
}

/** A payment the token's mind asked for. Amounts are yoctoNEAR. */
export type PaymentOutcome =
  | { status: "sent"; receiver_id: string; amount: string; memo: string; hash: string }
  | { status: "refused"; receiver_id: string; amount: string; memo: string; reason: string }
  | { status: "pending"; receiver_id: string; amount: string; memo: string; hash: string };

/** A token's mind as its owner downloads it, with the on-chain record that proves it. */
export interface MindExport {
  format: "nearkat-mind/1";
  collection: string | null;
  token_id: string;
  context: ContextDoc;
  record: { context_hash: string; context_ref: string; version: number; key_epoch: number };
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

/** What the keeper charges, in yoctoNEAR, and which model it runs. */
export interface KeeperInfo {
  chat_price: string;
  save_price: string;
  model: string;
}

/** What a keeper serves, and why it isn't serving the others it has seen. */
export interface KeeperCollections {
  home?: string;
  served?: Array<{ contract_id: string; name: string }>;
  waiting?: Array<{ contract_id: string; reason: string }>;
}

export interface Keeper {
  info(): Promise<KeeperInfo>;
  collections(): Promise<KeeperCollections>;
  attestation(): Promise<Record<string, unknown>>;
  challenge(): Promise<{ nonce: string; message: string; recipient: string }>;
  /** `callbackUrl` is the page URL given to the wallet, which web wallets sign over. */
  createSession(nonce: string, signed: SignedMessage, callbackUrl?: string): Promise<Session>;
  /** `collection` is the contract of a launched collection; omitted for the home one. */
  getContext(token: string, tokenId: string, collection?: string): Promise<ContextDoc>;
  chat(token: string, tokenId: string, message: string, collection?: string): Promise<ChatReply>;
  exportMind(token: string, tokenId: string, collection?: string): Promise<MindExport>;
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

  const kat = (tokenId: string, collection?: string) =>
    `${collection ? `/c/${encodeURIComponent(collection)}` : ""}/kats/${encodeURIComponent(tokenId)}`;
  return {
    info: () => request("GET", "/info"),
    collections: () => request("GET", "/collections"),
    attestation: () => request("GET", "/attestation"),
    challenge: () => request("POST", "/auth/challenge"),
    createSession: (nonce, signed, callbackUrl) =>
      request("POST", "/auth/session", {
        body: { nonce, signed_message: signed, callback_url: callbackUrl },
      }),
    getContext: (token, tokenId, collection) =>
      request("GET", `${kat(tokenId, collection)}/context`, { token }),
    chat: (token, tokenId, message, collection) =>
      request("POST", `${kat(tokenId, collection)}/chat`, { token, body: { message } }),
    exportMind: (token, tokenId, collection) =>
      request("GET", `${kat(tokenId, collection)}/export`, { token }),
  };
}
