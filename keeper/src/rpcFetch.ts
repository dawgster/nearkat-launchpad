/**
 * Public RPC endpoints refuse bursts: a page or a run that scans 200 samples
 * makes hundreds of view calls, and a free endpoint answers 429 after the
 * first hundred or so. `politeFetch` wraps `fetch` for the RPC endpoint the
 * app is configured with. A refused call (429, a 5xx, or a network error,
 * which is how a browser sees a 429 without CORS headers) is sent again, and
 * an endpoint that refuses rests for a growing pause.
 *
 * Only contract views are spread over the other endpoints: they are reads
 * any node can answer. Everything else (transactions, their status, access
 * keys) stays on the configured endpoint and waits for it, because
 * transactions sent at once must reach one node in order (their nonces), and
 * a second node may not know a transaction or a nonce yet. Sending a request
 * twice is safe: views are reads, and a signed transaction has the same hash
 * however often it is sent. Calls to any other URL pass through untouched.
 */
export interface PoliteOptions {
  /** Requests in flight at once, over all endpoints. */
  maxInFlight?: number;
  /** Times one call is tried before its last answer or error is returned. */
  attempts?: number;
  /** The first rest of a refusing endpoint, in ms; it doubles up to `maxRestMs`. */
  restMs?: number;
  maxRestMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Other public endpoints of the same network, tried when the configured one refuses. */
export function fallbackRpcUrls(network: string): string[] {
  if (network === "testnet") {
    return [
      "https://near-testnet.drpc.org",
      "https://rpc.testnet.fastnear.com",
      "https://archival-rpc.testnet.fastnear.com",
    ];
  }
  return [];
}

/** The endpoint near-kit uses for a network when none is configured. */
const DEFAULT_RPC: Record<string, string> = {
  testnet: "https://rpc.testnet.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
};

/**
 * Makes every call to the app's RPC endpoint polite, on testnet and mainnet.
 * A sandbox is left alone: it has no limits, and its tests fake `fetch`.
 */
export function installPoliteRpc(network: string, rpcUrl: string | null | undefined): void {
  const primary = rpcUrl || DEFAULT_RPC[network];
  if (!primary || !(network in DEFAULT_RPC)) {
    return;
  }
  globalThis.fetch = politeFetch(
    primary,
    fallbackRpcUrls(network),
    globalThis.fetch.bind(globalThis),
  );
}

const urlOf = (input: unknown): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : ((input as { url?: string })?.url ?? "");

const same = (a: string, b: string): boolean => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** A contract view call, going by its JSON-RPC body. */
const isView = (init: RequestInit | undefined): boolean =>
  typeof init?.body === "string" && init.body.includes('"call_function"');

export function politeFetch(
  primary: string,
  fallbacks: string[],
  real: typeof fetch,
  options: PoliteOptions = {},
): typeof fetch {
  const {
    maxInFlight = 8,
    attempts = 14,
    restMs = 700,
    maxRestMs = 6000,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const endpoints = [primary, ...fallbacks.filter((url) => !same(url, primary))].map((url) => ({
    url,
    restingUntil: 0,
    refusals: 0,
  }));
  let inFlight = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    inFlight--;
    waiting.shift()?.();
  };

  return async (input, init) => {
    if (!same(urlOf(input), primary) || typeof input !== "string") {
      return real(input, init);
    }
    if (inFlight >= maxInFlight) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    inFlight++;
    try {
      let last: Response | undefined;
      let failure: unknown;
      const candidates = isView(init) ? endpoints : endpoints.slice(0, 1);
      for (let attempt = 0; attempt < attempts; attempt++) {
        // The endpoint that is free soonest; the configured one wins a tie.
        const endpoint = candidates.reduce((a, b) => (b.restingUntil < a.restingUntil ? b : a));
        const wait = endpoint.restingUntil - now();
        if (wait > 0) {
          await sleep(wait);
        }
        let refused = false;
        try {
          last = await real(endpoint.url, init);
          failure = undefined;
          // 5xx is the endpoint's own trouble (a gateway in front of a busy node), not an answer.
          refused = last.status === 429 || last.status >= 500;
        } catch (error) {
          failure = error;
          refused = true;
        }
        if (!refused) {
          endpoint.refusals = 0;
          return last as Response;
        }
        endpoint.refusals++;
        const rest = Math.min(maxRestMs, restMs * 2 ** (endpoint.refusals - 1));
        endpoint.restingUntil = Math.max(endpoint.restingUntil, now() + rest);
      }
      if (failure !== undefined) {
        throw failure;
      }
      return last as Response;
    } finally {
      release();
    }
  };
}
