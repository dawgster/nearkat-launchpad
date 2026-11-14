import { describe, expect, it } from "vitest";
import { politeFetch } from "../src/rpcFetch.ts";

const A = "https://a.example";
const B = "https://b.example";
const answer = (status: number) => new Response(status === 200 ? "ok" : "no", { status });

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    at: () => t,
  };
}

describe("politeFetch", () => {
  it("passes other URLs through untouched", async () => {
    const seen: string[] = [];
    const f = politeFetch(A, [B], async (url) => {
      seen.push(String(url));
      return answer(200);
    });
    await f("https://other.example/x");
    expect(seen).toEqual(["https://other.example/x"]);
  });

  it("sends a refused call to the next endpoint and rests the one that refused", async () => {
    const seen: string[] = [];
    const time = clock();
    const f = politeFetch(
      A,
      [B],
      async (url) => {
        seen.push(String(url));
        return answer(url === A ? 429 : 200);
      },
      time,
    );
    expect((await f(A, { method: "POST" })).status).toBe(200);
    expect(seen).toEqual([A, B]);
    // A is resting, so the next call goes straight to B.
    await f(A, { method: "POST" });
    expect(seen).toEqual([A, B, B]);
  });

  it("treats a network error as a refusal, and waits when every endpoint rests", async () => {
    const time = clock();
    let calls = 0;
    const f = politeFetch(
      A,
      [],
      async () => {
        calls++;
        if (calls < 3) {
          throw new TypeError("Failed to fetch");
        }
        return answer(200);
      },
      time,
    );
    expect((await f(A)).status).toBe(200);
    expect(calls).toBe(3);
    expect(time.at()).toBeGreaterThan(0);
  });

  it("gives up after its attempts with the last answer", async () => {
    const f = politeFetch(A, [B], async () => answer(429), { ...clock(), attempts: 4 });
    expect((await f(A)).status).toBe(429);
  });

  it("keeps at most maxInFlight calls going", async () => {
    let active = 0;
    let most = 0;
    const f = politeFetch(
      A,
      [],
      async () => {
        most = Math.max(most, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return answer(200);
      },
      { maxInFlight: 3 },
    );
    await Promise.all(Array.from({ length: 12 }, () => f(A)));
    expect(most).toBe(3);
  });
});
