import { describe, expect, it } from "vitest";
import { politeFetch } from "../src/rpcFetch.ts";

const A = "https://a.example";
const B = "https://b.example";
const VIEW = {
  method: "POST",
  body: '{"method":"query","params":{"request_type":"call_function"}}',
};
const SEND = { method: "POST", body: '{"method":"send_tx","params":{}}' };
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

  it("sends a refused view to the next endpoint and rests the one that refused", async () => {
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
    expect((await f(A, VIEW)).status).toBe(200);
    expect(seen).toEqual([A, B]);
    // A is resting, so the next view goes straight to B.
    await f(A, VIEW);
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

  it("sends a view again when an endpoint answers 5xx", async () => {
    const seen: string[] = [];
    const f = politeFetch(
      A,
      [B],
      async (url) => {
        seen.push(String(url));
        return answer(url === A ? 502 : 200);
      },
      clock(),
    );
    expect((await f(A, VIEW)).status).toBe(200);
    expect(seen).toEqual([A, B]);
  });

  it("keeps a transaction on the configured endpoint, waiting for it", async () => {
    const seen: string[] = [];
    const time = clock();
    let refusals = 2;
    const f = politeFetch(
      A,
      [B],
      async (url) => {
        seen.push(String(url));
        return answer(refusals-- > 0 ? 429 : 200);
      },
      time,
    );
    expect((await f(A, SEND)).status).toBe(200);
    expect(seen).toEqual([A, A, A]);
    expect(time.at()).toBeGreaterThan(0);
  });

  it("gives up after its attempts with the last answer", async () => {
    const f = politeFetch(A, [B], async () => answer(429), { ...clock(), attempts: 4 });
    expect((await f(A, VIEW)).status).toBe(429);
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
