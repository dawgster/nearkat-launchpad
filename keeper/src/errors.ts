/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
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

/** The stored context does not match the hash recorded on-chain. */
export class CorruptContextError extends Error {}

/** The inference provider failed or returned something unusable. */
export class InferenceError extends Error {}
