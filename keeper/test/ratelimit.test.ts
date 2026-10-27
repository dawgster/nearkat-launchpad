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
});
