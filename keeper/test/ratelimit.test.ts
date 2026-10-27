import { describe, expect, test } from "vitest";
import { RateLimiter } from "../src/ratelimit.ts";

describe("RateLimiter", () => {
  test("allows a burst, then one request per refill period", () => {
    let now = 0;
    const limiter = new RateLimiter({ burst: 3, refillMs: 1000, now: () => now });
    expect([limiter.take("a"), limiter.take("a"), limiter.take("a")]).toEqual([0, 0, 0]);
    expect(limiter.take("a")).toBe(1000);
    now += 500;
    expect(limiter.take("a")).toBe(500);
    now += 1000;
    expect(limiter.take("a")).toBe(0);
  });

  test("keeps every key's bucket apart", () => {
    const limiter = new RateLimiter({ burst: 1, refillMs: 1000, now: () => 0 });
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("b")).toBe(0);
    expect(limiter.take("a")).toBeGreaterThan(0);
  });

  test("keeps at most maxKeys buckets, dropping the least recently used", () => {
    const limiter = new RateLimiter({ burst: 1, refillMs: 60_000, maxKeys: 2, now: () => 0 });
    limiter.take("a");
    limiter.take("b");
    limiter.take("a");
    limiter.take("c");
    expect(limiter.size).toBe(2);
    // "b" was dropped, so it starts with a full bucket again; "a" was kept.
    expect(limiter.take("b")).toBe(0);
    expect(limiter.take("c")).toBeGreaterThan(0);
  });
});
