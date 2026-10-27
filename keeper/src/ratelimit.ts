/**
 * Token buckets per key: `burst` requests at once, then one every
 * `refillMs`. Keys whose buckets are full again are forgotten, so memory
 * stays bounded by the clients active in the last few minutes.
 */
export class RateLimiter {
  readonly #burst: number;
  readonly #refillMs: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, { tokens: number; at: number }>();

  constructor(options: { burst: number; refillMs: number; now?: () => number }) {
    this.#burst = options.burst;
    this.#refillMs = options.refillMs;
    this.#now = options.now ?? Date.now;
  }

  /** Takes one request from `key`'s bucket. Returns 0 if allowed, else milliseconds to wait. */
  take(key: string): number {
    const now = this.#now();
    const bucket = this.#buckets.get(key) ?? { tokens: this.#burst, at: now };
    const tokens = Math.min(this.#burst, bucket.tokens + (now - bucket.at) / this.#refillMs);
    if (tokens < 1) {
      this.#buckets.set(key, { tokens, at: now });
      return Math.ceil((1 - tokens) * this.#refillMs);
    }
    this.#buckets.set(key, { tokens: tokens - 1, at: now });
    if (this.#buckets.size > 10_000) {
      this.#prune(now);
    }
    return 0;
  }

  #prune(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.tokens + (now - bucket.at) / this.#refillMs >= this.#burst) {
        this.#buckets.delete(key);
      }
    }
  }
}
