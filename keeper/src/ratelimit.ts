/**
 * Token buckets per key: `burst` requests at once, then one every
 * `refillMs`. At most `maxKeys` buckets are kept; past that the least
 * recently used is dropped, which only ever forgives a client, so memory
 * and work per request stay bounded whatever the number of clients.
 */
export class RateLimiter {
  readonly #burst: number;
  readonly #refillMs: number;
  readonly #maxKeys: number;
  readonly #now: () => number;
  /** In least-recently-used order: every use moves a key to the end. */
  readonly #buckets = new Map<string, { tokens: number; at: number }>();

  constructor(options: { burst: number; refillMs: number; maxKeys?: number; now?: () => number }) {
    this.#burst = options.burst;
    this.#refillMs = options.refillMs;
    this.#maxKeys = options.maxKeys ?? 50_000;
    this.#now = options.now ?? Date.now;
  }

  /** Takes one request from `key`'s bucket. Returns 0 if allowed, else milliseconds to wait. */
  take(key: string): number {
    const now = this.#now();
    const bucket = this.#buckets.get(key);
    this.#buckets.delete(key);
    const tokens = bucket
      ? Math.min(this.#burst, bucket.tokens + (now - bucket.at) / this.#refillMs)
      : this.#burst;
    const allowed = tokens >= 1;
    this.#buckets.set(key, { tokens: allowed ? tokens - 1 : tokens, at: now });
    while (this.#buckets.size > this.#maxKeys) {
      const oldest = this.#buckets.keys().next().value as string;
      this.#buckets.delete(oldest);
    }
    return allowed ? 0 : Math.ceil((1 - tokens) * this.#refillMs);
  }

  get size(): number {
    return this.#buckets.size;
  }
}
