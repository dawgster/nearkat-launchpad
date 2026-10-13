# Nearkat Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the web app where owners mint a kat, talk to it, shape its personality, give it away, and verify what the keeper tells them.

**Architecture:** A static single-page app in `web/`. It reads the contract directly through near-kit, sends transactions through the visitor's wallet (NEAR Connect), and calls the keeper for anything touching a kat's mind. Logic lives in small tested modules under `src/lib`; components take plain callbacks; pages do the wiring.

**Tech Stack:** Vite 8, React 19, React Router 8, Tailwind 4, near-kit 0.20, NEAR Connect 0.11, Vitest 5 with Testing Library, Playwright 1.64, Biome 2.

**Spec:** `docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md` (section "4. Web app", plus "Flows" and "Trust model").

This is plan 3 of 4. Plans 1 (contract) and 2 (keeper) are merged. Later: (4) probes plus TEE and NOVA deployment.

All code in this plan was run before the plan was written: 91 unit and component tests pass, the type-checker and linter are clean, the production build succeeds, and the two-part browser story passes against a sandbox node, the real contract and the real keeper.

## Global Constraints

- The spec named Next.js; this plan uses Vite and React, to match nearkat.xyz and because the app has no server side. The spec is updated in Task 6.
- Contract calls go directly from the wallet; everything touching context goes through the keeper.
- Only the owner's wallet may open a kat's mind; the app never shows a personality or memory to anyone else.
- Personality prompts and chat messages are limited to 4,000 characters.
- Prices shown: 0.002 NEAR per message, 0.05 NEAR per saved personality.
- The verify page states plainly what it could and could not check. In local keeper mode it says the operator can read kat minds.
- Kat artwork does not exist yet; `KatBadge` is the placeholder.
- No interface text in all caps, no decorative arrows on buttons, and monospace only for account ids and hashes.
- Works down to phone width, with visible keyboard focus and reduced motion respected.
- Run every command from `web/` unless a step says otherwise.

## Review Focus

Each line names a condition the spec implies but does not spell out, and the test that pins it.

1. The keeper trails the chain after a mint or a transfer: the kat page waits and retries, and the new owner sees the kat without pressing anything. Tests: both parts of the browser story (Task 6).
2. The keeper restarts or the token expires mid-session: the next call signs in again once and succeeds; a keeper that keeps rejecting does not cause a loop. Tests `signs in again and retries once when the keeper rejects the token`, `does not loop when the keeper keeps rejecting` (Task 2).
3. A message goes unanswered (model down, kat out of NEAR): the text returns to the box so it is not lost, and the reason is shown. Tests `puts an unanswered message back in the box and says why`, `points at the balance when the kat has run out of NEAR` (Task 4).
4. The owner cancels the wallet prompt: nothing is sent and the form is usable again. Tests `says what went wrong when the wallet request is cancelled` (Task 4), `lets a rejected wallet prompt fail the call, and asks again next time` (Task 2).
5. A reply's signature is over different text, or from a different signer: the verify page reports it as invalid. Tests `rejects a signature that was made over different text`, `rejects a signature attributed to a different address` (Task 3).

## File Structure

| File | Responsibility |
|---|---|
| `web/src/lib/config.ts` | Reads `VITE_*` settings. |
| `web/src/lib/format.ts` | NEAR amounts to and from text; shortening ids. |
| `web/src/lib/keeper.ts` | Typed client for the keeper's HTTP API. |
| `web/src/lib/session.ts` | Wallet-signed keeper session, kept per tab. |
| `web/src/lib/contract.ts` | Contract views and transactions over near-kit. |
| `web/src/lib/verify.ts` | Context hash and reply-signature checks. |
| `web/src/lib/problems.ts` | Turns any failure into a sentence a person can act on. |
| `web/src/lib/useAsync.ts`, `proof.ts` | Loading helper; remembers a kat's latest reply proof. |
| `web/src/wallet/` | Wallet backends (NEAR Connect, dev key) and the React provider. |
| `web/src/services.tsx` | Builds the keeper, contract and session objects for the pages. |
| `web/src/components/` | Shell, horizon illustration, kat badge, and the five panels. |
| `web/src/pages/` | `Home` (surface), `Kat` (burrow), `Verify`. |
| `web/src/index.css` | Colours, fonts and the two backdrops. |
| `web/e2e/` | Harness and the browser story. |

---
### Task 1: Project setup, configuration and formatting

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/biome.json`
- Create: `web/.gitignore`
- Create: `web/index.html`
- Create: `web/test/setup.ts`
- Create: `web/src/lib/config.ts`
- Create: `web/src/lib/format.ts`
- Test: `web/test/config.test.ts`
- Test: `web/test/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig(env): AppConfig` with `network`, `contractId`, `keeperUrl`, `devWallet`; `formatNear(yocto, decimals?)`, `parseNear(text): bigint | null`, `shorten(text, keep?)`.

The stack matches nearkat.xyz itself: Vite, React and Tailwind. The app is static and purely client-side, so there is no server framework.

- [ ] **Step 1: Create the project files**

`web/package.json`:

```json
{
  "name": "nearkat-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@fontsource/archivo-black": "^5.0.0",
    "@fontsource/space-grotesk": "^5.0.0",
    "@hot-labs/near-connect": "^0.11.4",
    "@noble/curves": "^2.4.0",
    "@noble/hashes": "^2.4.0",
    "near-kit": "^0.20.2",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "react-router": "^8.4.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.15",
    "@playwright/test": "^1.64.0",
    "@tailwindcss/vite": "^4.3.3",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.0.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^6.1.2",
    "happy-dom": "^21.0.1",
    "tailwindcss": "^4.3.3",
    "typescript": "^7.0.2",
    "vite": "^8.3.4",
    "vitest": "^5.0.4"
  }
}
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "test", "e2e", "*.ts"]
}
```

`web/vite.config.ts`:

```typescript
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000, strictPort: true },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
```

`web/biome.json`:

```json
{
  "files": { "includes": ["src/**", "test/**", "e2e/**", "*.ts", "*.json"] },
  "formatter": { "indentStyle": "space", "lineWidth": 100 },
  "linter": { "rules": { "preset": "recommended" } },
  "css": { "parser": { "tailwindDirectives": true } }
}
```

`web/.gitignore`:

```text
node_modules/
dist/
.env
.env.local
test-results/
playwright-report/
```

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#030b11" />
    <meta
      name="description"
      content="Raise a nearkat: an NFT with a mind you shape. Give it away and its memories go with it."
    />
    <title>Nearkat burrow</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/test/setup.ts`:

```typescript
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
```

Then run `npm install` in `web/`.

- [ ] **Step 2: Write the failing tests**

`web/test/config.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/lib/config.ts";

const base = { VITE_CONTRACT_ID: "nearkat.testnet" };

describe("loadConfig", () => {
  test("defaults to testnet and a local keeper", () => {
    expect(loadConfig(base)).toEqual({
      network: "testnet",
      contractId: "nearkat.testnet",
      keeperUrl: "http://localhost:8787",
      devWallet: null,
    });
  });

  test("strips trailing slashes from the keeper URL", () => {
    expect(loadConfig({ ...base, VITE_KEEPER_URL: "https://keeper.example//" }).keeperUrl).toBe(
      "https://keeper.example",
    );
  });

  test("builds a custom network for a sandbox", () => {
    const config = loadConfig({
      ...base,
      VITE_NEAR_NETWORK: "sandbox",
      VITE_NEAR_RPC_URL: "http://127.0.0.1:3030",
    });
    expect(config.network).toEqual({ rpcUrl: "http://127.0.0.1:3030", networkId: "localnet" });
  });

  test("reads the dev wallet when both of its variables are set", () => {
    const config = loadConfig({
      ...base,
      VITE_DEV_WALLET_ID: "alice.test",
      VITE_DEV_WALLET_KEY: "ed25519:abc",
    });
    expect(config.devWallet).toEqual({ accountId: "alice.test", privateKey: "ed25519:abc" });
  });

  test.each([
    ["no contract id", {}, "VITE_CONTRACT_ID"],
    ["an unknown network", { ...base, VITE_NEAR_NETWORK: "devnet" }, "VITE_NEAR_NETWORK"],
    [
      "a sandbox without an RPC URL",
      { ...base, VITE_NEAR_NETWORK: "sandbox" },
      "VITE_NEAR_RPC_URL",
    ],
    [
      "a dev wallet on mainnet",
      {
        ...base,
        VITE_NEAR_NETWORK: "mainnet",
        VITE_DEV_WALLET_ID: "a.near",
        VITE_DEV_WALLET_KEY: "ed25519:abc",
      },
      "mainnet",
    ],
  ])("rejects %s", (_name, env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });
});
```

`web/test/format.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { formatNear, parseNear, shorten } from "../src/lib/format.ts";

const NEAR = 10n ** 24n;

describe("formatNear", () => {
  test.each([
    [0n, "0"],
    [NEAR, "1"],
    [NEAR + NEAR / 2n, "1.5"],
    [2n * 10n ** 21n, "0.002"],
    [1234567n * 10n ** 18n, "1.234"],
    [10n ** 20n, "0"],
    [-NEAR / 4n, "-0.25"],
  ])("formats %s yocto as %s", (yocto, text) => {
    expect(formatNear(yocto)).toBe(text);
  });

  test("accepts a string and a custom precision", () => {
    expect(formatNear("1234567000000000000000000", 5)).toBe("1.23456");
  });
});

describe("parseNear", () => {
  test.each([
    ["1", NEAR],
    ["0.5", NEAR / 2n],
    [" 2.25 ", (NEAR * 9n) / 4n],
    ["0.000000000000000000000001", 1n],
    ["0", 0n],
  ])("parses %j", (text, yocto) => {
    expect(parseNear(text)).toBe(yocto);
  });

  test.each(["", "abc", "-1", "1.", ".5", "1e3", "1,5", "0.0000000000000000000000001"])(
    "rejects %j",
    (text) => {
      expect(parseNear(text)).toBeNull();
    },
  );
});

describe("shorten", () => {
  test("keeps short text whole and trims the middle of long text", () => {
    expect(shorten("alice.near")).toBe("alice.near");
    expect(shorten("a".repeat(10) + "b".repeat(44) + "c".repeat(10))).toBe("aaaaaaaa…cccccccc");
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because the modules they import do not exist yet; earlier test files still pass.

- [ ] **Step 4: Implement**

`web/src/lib/config.ts`:

```typescript
export interface AppConfig {
  /** A network name, or a custom RPC endpoint for a local sandbox. */
  network: "testnet" | "mainnet" | { rpcUrl: string; networkId: string };
  contractId: string;
  keeperUrl: string;
  /** Test-only: sign with this key instead of a browser wallet. */
  devWallet: { accountId: string; privateKey: string } | null;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): AppConfig {
  const contractId = env.VITE_CONTRACT_ID;
  if (!contractId) {
    throw new Error("VITE_CONTRACT_ID is not set");
  }
  const network = env.VITE_NEAR_NETWORK ?? "testnet";
  if (network !== "testnet" && network !== "mainnet" && network !== "sandbox") {
    throw new Error("VITE_NEAR_NETWORK must be testnet, mainnet or sandbox");
  }
  if (network === "sandbox" && !env.VITE_NEAR_RPC_URL) {
    throw new Error("VITE_NEAR_RPC_URL is required when VITE_NEAR_NETWORK is sandbox");
  }
  const devWallet =
    env.VITE_DEV_WALLET_ID && env.VITE_DEV_WALLET_KEY
      ? { accountId: env.VITE_DEV_WALLET_ID, privateKey: env.VITE_DEV_WALLET_KEY }
      : null;
  if (devWallet && network === "mainnet") {
    throw new Error("The dev wallet cannot be used on mainnet");
  }
  return {
    network: env.VITE_NEAR_RPC_URL
      ? {
          rpcUrl: env.VITE_NEAR_RPC_URL,
          networkId: network === "sandbox" ? "localnet" : network,
        }
      : (network as "testnet" | "mainnet"),
    contractId,
    keeperUrl: (env.VITE_KEEPER_URL ?? "http://localhost:8787").replace(/\/+$/, ""),
    devWallet,
  };
}
```

`web/src/lib/format.ts`:

```typescript
const YOCTO_PER_NEAR = 10n ** 24n;

/** Formats yoctoNEAR as NEAR, rounded down, without trailing zeros. */
export function formatNear(yocto: string | bigint, decimals = 3): string {
  const value = BigInt(yocto);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const unit = 10n ** BigInt(24 - decimals);
  const scaled = abs / unit;
  const whole = scaled / 10n ** BigInt(decimals);
  const fraction = (scaled % 10n ** BigInt(decimals))
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Parses a NEAR amount typed by a person. Returns null if it is not a valid amount. */
export function parseNear(text: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, whole = "0", fraction = ""] = match;
  return BigInt(whole) * YOCTO_PER_NEAR + BigInt(fraction.padEnd(24, "0"));
}

/** Shortens a long account id or hash for display, keeping both ends. */
export function shorten(text: string, keep = 8): string {
  return text.length <= keep * 2 + 1 ? text : `${text.slice(0, keep)}…${text.slice(-keep)}`;
}
```

- [ ] **Step 5: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): add project setup, configuration and NEAR formatting"
```

### Task 2: Keeper client and session

**Files:**
- Create: `web/src/lib/keeper.ts`
- Create: `web/src/lib/session.ts`
- Test: `web/test/keeper.test.ts`
- Test: `web/test/session.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: types `ContextDoc`, `Verification`, `SignatureInfo`, `ChatReply`, `Session`, `SignedMessage`; `KeeperError(status, code, message, extra)`; `createKeeper(baseUrl, fetch?): Keeper` with `attestation`, `challenge`, `createSession`, `getContext`, `setPersonality`, `chat`; `KeeperSession({ keeper, accountId, signMessage, storage?, now? })` with `call(run)`.

`KeeperSession` exists so the owner is asked to sign once per tab, not once per request. It renews the token when it is about to expire or the keeper rejects it, and never loops.

- [ ] **Step 1: Write the failing tests**

`web/test/keeper.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { createKeeper, KeeperError } from "../src/lib/keeper.ts";

interface Call {
  url: string;
  init: RequestInit;
}

function setup(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const keeper = createKeeper("https://keeper.example", (async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch);
  return { keeper, calls };
}

describe("createKeeper", () => {
  test("sends the session token and JSON body to the kat's route", async () => {
    const { keeper, calls } = setup(() => Response.json({ reply: "meow" }));
    expect(await keeper.chat("tok", "7", "hello")).toEqual({ reply: "meow" });
    expect(calls[0]?.url).toBe("https://keeper.example/kats/7/chat");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
  });

  test("uses the right method and path for each call", async () => {
    const { keeper, calls } = setup(() => Response.json({}));
    await keeper.attestation();
    await keeper.challenge();
    await keeper.createSession("n", { accountId: "a.near", publicKey: "pk", signature: "sig" });
    await keeper.getContext("tok", "7");
    await keeper.setPersonality("tok", "7", "grumpy");
    expect(calls.map((call) => `${call.init.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /attestation",
      "POST /auth/challenge",
      "POST /auth/session",
      "GET /kats/7/context",
      "PUT /kats/7/personality",
    ]);
    expect(calls[2]?.init.body).toBe(
      JSON.stringify({
        nonce: "n",
        signed_message: { accountId: "a.near", publicKey: "pk", signature: "sig" },
      }),
    );
  });

  test("escapes a token id so it cannot change the path", async () => {
    const { keeper, calls } = setup(() => Response.json({}));
    await keeper.getContext("tok", "1/../2");
    expect(calls[0]?.url).toBe("https://keeper.example/kats/1%2F..%2F2/context");
  });

  test("turns an error response into a KeeperError carrying its details", async () => {
    const { keeper } = setup(() =>
      Response.json(
        { error: "insufficient_balance", message: "Kat 7 needs more NEAR", balance: "5" },
        { status: 402 },
      ),
    );
    const error = await keeper.chat("tok", "7", "hi").catch((caught) => caught);
    expect(error).toBeInstanceOf(KeeperError);
    expect(error).toMatchObject({
      status: 402,
      code: "insufficient_balance",
      message: "Kat 7 needs more NEAR",
      extra: { balance: "5" },
    });
  });

  test("reports an error response that is not JSON", async () => {
    const { keeper } = setup(() => new Response("Bad Gateway", { status: 502 }));
    await expect(keeper.attestation()).rejects.toMatchObject({ status: 502, code: "unknown" });
  });

  test("reports an unreachable keeper as its own kind of error", async () => {
    const { keeper } = setup(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(keeper.attestation()).rejects.toMatchObject({ status: 0, code: "unreachable" });
  });
});
```

`web/test/session.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { type Keeper, KeeperError } from "../src/lib/keeper.ts";
import { KeeperSession, type SignMessage } from "../src/lib/session.ts";

function setup() {
  let now = 1_000_000;
  let issued = 0;
  const keeper = {
    challenge: vi.fn(async () => ({
      nonce: btoa("n".repeat(32)),
      message: "Sign in",
      recipient: "r",
    })),
    createSession: vi.fn(async () => {
      issued += 1;
      return { token: `token-${issued}`, account_id: "alice.near", expires_at: now + 900_000 };
    }),
  } as unknown as Keeper;
  const signMessage = vi.fn<SignMessage>(async () => ({
    accountId: "alice.near",
    publicKey: "ed25519:pk",
    signature: "sig",
  }));
  const make = (accountId = "alice.near") =>
    new KeeperSession({ keeper, accountId, signMessage, now: () => now });
  return { keeper, signMessage, make, session: make(), advance: (ms: number) => (now += ms) };
}

describe("KeeperSession", () => {
  test("signs the keeper's challenge and passes the token to the call", async () => {
    const { session, signMessage, keeper } = setup();
    expect(await session.call(async (token) => `used ${token}`)).toBe("used token-1");
    expect(signMessage).toHaveBeenCalledWith({
      message: "Sign in",
      recipient: "r",
      nonce: Uint8Array.from("n".repeat(32), (char) => char.charCodeAt(0)),
    });
    expect(keeper.createSession).toHaveBeenCalledWith(btoa("n".repeat(32)), {
      accountId: "alice.near",
      publicKey: "ed25519:pk",
      signature: "sig",
    });
  });

  test("asks the wallet once and reuses the token afterwards", async () => {
    const { session, make, signMessage } = setup();
    await session.call(async () => 1);
    await session.call(async () => 2);
    await make().call(async () => 3);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  test("shares one wallet prompt between calls made at the same time", async () => {
    const { session, signMessage } = setup();
    const tokens = await Promise.all([
      session.call(async (token) => token),
      session.call(async (token) => token),
    ]);
    expect(tokens).toEqual(["token-1", "token-1"]);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  test("signs in again once the token is about to expire", async () => {
    const { session, advance } = setup();
    await session.call(async () => 1);
    advance(900_000 - 30_000);
    expect(await session.call(async (token) => token)).toBe("token-2");
  });

  test("signs in again and retries once when the keeper rejects the token", async () => {
    const { session } = setup();
    const run = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(new KeeperError(401, "unauthorized", "expired"))
      .mockImplementation(async (token) => token);
    expect(await session.call(run)).toBe("token-2");
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("does not loop when the keeper keeps rejecting", async () => {
    const { session, signMessage } = setup();
    const run = vi.fn(async () => {
      throw new KeeperError(401, "unauthorized", "no");
    });
    await expect(session.call(run)).rejects.toMatchObject({ status: 401 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  test("passes other errors through without signing in again", async () => {
    const { session, signMessage } = setup();
    await expect(
      session.call(async () => {
        throw new KeeperError(403, "not_owner", "no");
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  test("keeps each account's token separate", async () => {
    const { make, signMessage } = setup();
    await make("alice.near").call(async () => 1);
    expect(await make("bob.near").call(async (token) => token)).toBe("token-2");
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  test("lets a rejected wallet prompt fail the call, and asks again next time", async () => {
    const { session, signMessage } = setup();
    signMessage.mockRejectedValueOnce(new Error("User rejected"));
    await expect(session.call(async () => 1)).rejects.toThrow("User rejected");
    expect(await session.call(async (token) => token)).toBe("token-1");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because the modules they import do not exist yet; earlier test files still pass.

- [ ] **Step 3: Implement**

`web/src/lib/keeper.ts`:

```typescript
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
```

`web/src/lib/session.ts`:

```typescript
import { type Keeper, KeeperError, type Session, type SignedMessage } from "./keeper.ts";

export type SignMessage = (params: {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}) => Promise<SignedMessage>;

/** Keeps a 30-second margin so a token is never sent just as it expires. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * Holds the keeper session for one account. Signing in costs the user a
 * wallet prompt, so the token is kept for the browser tab and only renewed
 * when it has expired or the keeper rejects it.
 */
export class KeeperSession {
  readonly #keeper: Keeper;
  readonly #accountId: string;
  readonly #signMessage: SignMessage;
  readonly #storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly #now: () => number;
  #signingIn: Promise<string> | null = null;

  constructor(options: {
    keeper: Keeper;
    accountId: string;
    signMessage: SignMessage;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    now?: () => number;
  }) {
    this.#keeper = options.keeper;
    this.#accountId = options.accountId;
    this.#signMessage = options.signMessage;
    this.#storage = options.storage ?? sessionStorage;
    this.#now = options.now ?? Date.now;
  }

  /** Runs a keeper call with a valid token, signing in first if needed. */
  async call<T>(run: (token: string) => Promise<T>): Promise<T> {
    try {
      return await run(await this.#token());
    } catch (error) {
      if (!(error instanceof KeeperError) || error.status !== 401) {
        throw error;
      }
      // The keeper no longer accepts the token (for example, it restarted).
      this.#storage.removeItem(this.#key);
      return run(await this.#token());
    }
  }

  get #key(): string {
    return `nearkat.session.${this.#accountId}`;
  }

  async #token(): Promise<string> {
    const stored = this.#storage.getItem(this.#key);
    if (stored) {
      try {
        const session = JSON.parse(stored) as Session;
        if (session.expires_at - EXPIRY_MARGIN_MS > this.#now()) {
          return session.token;
        }
      } catch {
        // fall through to a fresh sign-in
      }
    }
    // Several calls may need a token at once; they share one wallet prompt.
    this.#signingIn ??= this.#signIn().finally(() => {
      this.#signingIn = null;
    });
    return this.#signingIn;
  }

  async #signIn(): Promise<string> {
    const challenge = await this.#keeper.challenge();
    const nonce = Uint8Array.from(atob(challenge.nonce), (char) => char.charCodeAt(0));
    const signed = await this.#signMessage({
      message: challenge.message,
      recipient: challenge.recipient,
      nonce,
    });
    const session = await this.#keeper.createSession(challenge.nonce, {
      accountId: signed.accountId,
      publicKey: signed.publicKey,
      signature: signed.signature,
    });
    this.#storage.setItem(this.#key, JSON.stringify(session));
    return session.token;
  }
}
```

- [ ] **Step 4: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): add keeper client and wallet-signed sessions"
```

### Task 3: Verification and the contract client

**Files:**
- Create: `web/src/lib/verify.ts`
- Create: `web/src/lib/contract.ts`
- Test: `web/test/verify.test.ts`

**Interfaces:**
- Consumes: `ContextDoc`, `Verification`.
- Produces: `contextHash(doc): string` (base64), `checkSignature(verification): SignatureCheck`; `KatContract(near, contractId)` with `getKat`, `getConfig`, `katsOf`, `mint`, `fund`, `transfer`, `accountHoldsKey`; `MINT_STORAGE_ALLOWANCE`.

`contextHash` must match the keeper byte for byte; its test vector was produced by the keeper's own function. `checkSignature` is tested against the signing example from the web3.js documentation and against a real reply signature captured from NEAR AI Cloud. `contract.ts` is a thin wrapper over near-kit with no unit tests of its own; Task 6 exercises it against a real contract.

- [ ] **Step 1: Write the failing tests**

`web/test/verify.test.ts`:

```typescript
import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, test } from "vitest";
import type { ContextDoc, Verification } from "../src/lib/keeper.ts";
import { checkSignature, contextHash } from "../src/lib/verify.ts";

describe("contextHash", () => {
  // Produced by the keeper's own contextHash for this document.
  const doc: ContextDoc = {
    token_id: "7",
    version: 3,
    salt: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=",
    personality: 'You are grumpy — "très" grumpy.\nNew line 🐾',
    memory_summary: "likes fish",
  };

  test("matches the hash the keeper computes for the same context", () => {
    expect(contextHash(doc)).toBe("b3LAgEbZYDvAhCcoGYIY5szZSaUToYcEZqDZ93mr3mk=");
  });

  test("changes when the personality changes", () => {
    expect(contextHash({ ...doc, personality: "cheerful" })).not.toBe(contextHash(doc));
  });
});

describe("checkSignature", () => {
  // The signing example from the web3.js documentation.
  const ethereum = {
    text: "Some data",
    signature:
      "0xb91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c",
    signing_address: "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23",
    signing_algo: "ecdsa",
    signature_kind: "provider_tee",
  };
  const reply = (signature: Verification["signature"], hashes = ["req", "res"]): Verification => ({
    chat_id: "chat-1",
    model: "m",
    request_hash: hashes[0] as string,
    response_hash: hashes[1] as string,
    signature,
  });

  test("accepts an Ethereum-style signature from the stated address", () => {
    expect(checkSignature(reply(ethereum))).toEqual({
      status: "valid",
      signer: "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23",
      kind: "provider_tee",
      coversReply: false,
    });
  });

  test("accepts a real reply signature from NEAR AI Cloud and sees that it names the reply", () => {
    // Captured from a live call to z-ai/glm-5.3-flash on 2026-10-13.
    const requestHash = "de2420663e7f5eb2d437816a0dfb07a14668775850de32c5641e5f9247fe318b";
    const responseHash = "16349d1f870f8eb99fc76f375ca34252d8dffd67331265312e2566461ca57dcd";
    const live = {
      text: `z-ai/glm-5.3-flash:${requestHash}:${responseHash}`,
      signature:
        "0xbbd700f1630926c4ca692bfc941afc71ff5f2d7b8956b7828515fcdaa07e448b098191d07b6f7f72805c2726a9674db356d9d590bf4e292424e47f7471f8a8331b",
      signing_address: "0x3b753b4406613c5e70ae640508632b600424fa0c",
      signing_algo: "ecdsa",
      signature_kind: "provider_tee",
    };
    expect(checkSignature(reply(live, [requestHash, responseHash]))).toEqual({
      status: "valid",
      signer: "0x3b753b4406613c5e70ae640508632b600424fa0c",
      kind: "provider_tee",
      coversReply: true,
    });
  });

  test("rejects a signature that was made over different text", () => {
    expect(checkSignature(reply({ ...ethereum, text: "Other data" }))).toEqual({
      status: "invalid",
    });
  });

  test("rejects a signature attributed to a different address", () => {
    const other = { ...ethereum, signing_address: `0x${"11".repeat(20)}` };
    expect(checkSignature(reply(other))).toEqual({ status: "invalid" });
  });

  test("rejects a malformed signature without throwing", () => {
    expect(checkSignature(reply({ ...ethereum, signature: "0x1234" }))).toEqual({
      status: "invalid",
    });
    expect(checkSignature(reply({ ...ethereum, signature: "not hex" }))).toEqual({
      status: "invalid",
    });
  });

  test("accepts an ed25519 signature and notes that it names this reply's hashes", () => {
    const secret = new Uint8Array(32).fill(5);
    const text = "model:aaa:bbb";
    const signed = {
      text,
      signature: Buffer.from(ed25519.sign(new TextEncoder().encode(text), secret)).toString("hex"),
      signing_address: Buffer.from(ed25519.getPublicKey(secret)).toString("hex"),
      signing_algo: "ed25519",
      signature_kind: "gateway",
    };
    expect(checkSignature(reply(signed, ["aaa", "bbb"]))).toMatchObject({
      status: "valid",
      kind: "gateway",
      coversReply: true,
    });
    expect(checkSignature(reply(signed, ["aaa", "zzz"]))).toMatchObject({
      status: "valid",
      coversReply: false,
    });
  });

  test("reports a missing signature and an algorithm it does not know", () => {
    expect(checkSignature(reply(null))).toEqual({ status: "missing" });
    expect(checkSignature(reply({ ...ethereum, signing_algo: "rsa" }))).toEqual({
      status: "unsupported",
      algo: "rsa",
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because the modules they import do not exist yet; earlier test files still pass.

- [ ] **Step 3: Implement**

`web/src/lib/verify.ts`:

```typescript
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { ContextDoc, Verification } from "./keeper.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error("Not a hex string");
  }
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/**
 * The hash the contract records for a context: SHA-256 over the salt bytes
 * followed by the JSON of every other field in this fixed order. It must
 * match the keeper's `contextHash` byte for byte.
 */
export function contextHash(doc: ContextDoc): string {
  const canonical = JSON.stringify({
    token_id: doc.token_id,
    version: doc.version,
    personality: doc.personality,
    memory_summary: doc.memory_summary,
  });
  const salt = fromBase64(doc.salt);
  const input = new Uint8Array(salt.length + utf8(canonical).length);
  input.set(salt);
  input.set(utf8(canonical), salt.length);
  return toBase64(sha256(input));
}

export type SignatureCheck =
  /** No signature came back with the reply. */
  | { status: "missing" }
  /** The signature is not one this app knows how to check. */
  | { status: "unsupported"; algo: string }
  | { status: "invalid" }
  /**
   * Signed by `signer`. `coversReply` says whether the signed text names this
   * reply's request and response hashes.
   */
  | { status: "valid"; signer: string; kind: string; coversReply: boolean };

/** Recovers the Ethereum-style address that signed `text` (EIP-191 personal sign). */
function recoverEthereumSigner(text: string, signatureHex: string): string {
  const signature = fromHex(signatureHex);
  if (signature.length !== 65) {
    throw new Error("An ECDSA signature must be 65 bytes");
  }
  const message = utf8(text);
  const digest = keccak_256(
    new Uint8Array([...utf8(`\x19Ethereum Signed Message:\n${message.length}`), ...message]),
  );
  const v = signature[64] as number;
  const recovery = v >= 27 ? v - 27 : v;
  const publicKey = secp256k1.Signature.fromBytes(signature.subarray(0, 64), "compact")
    .addRecoveryBit(recovery)
    .recoverPublicKey(digest)
    .toBytes(false);
  return `0x${toHex(keccak_256(publicKey.subarray(1)).subarray(12))}`;
}

/**
 * Checks the inference provider's signature on a reply. This shows that the
 * holder of the signing key signed these hashes; it does not show which
 * hardware holds that key, which needs the provider's attestation report.
 */
export function checkSignature(verification: Verification): SignatureCheck {
  const info = verification.signature;
  if (!info) {
    return { status: "missing" };
  }
  const coversReply =
    info.text.includes(verification.request_hash) && info.text.includes(verification.response_hash);
  try {
    if (info.signing_algo === "ecdsa") {
      const signer = recoverEthereumSigner(info.text, info.signature);
      return signer === info.signing_address.toLowerCase()
        ? { status: "valid", signer, kind: info.signature_kind, coversReply }
        : { status: "invalid" };
    }
    if (info.signing_algo === "ed25519") {
      const valid = ed25519.verify(
        fromHex(info.signature),
        utf8(info.text),
        fromHex(info.signing_address),
      );
      return valid
        ? { status: "valid", signer: info.signing_address, kind: info.signature_kind, coversReply }
        : { status: "invalid" };
    }
  } catch {
    return { status: "invalid" };
  }
  return { status: "unsupported", algo: info.signing_algo };
}
```

`web/src/lib/contract.ts`:

```typescript
import type { Near } from "near-kit";

/** A kat as the contract's `get_kat` view returns it. */
export interface KatView {
  owner_id: string;
  context_hash: string | null;
  context_ref: string | null;
  context_version: string;
  balance: string;
}

export interface ContractConfig {
  admin_id: string;
  keeper_id: string;
  treasury_id: string;
  mint_price: string;
}

/**
 * Storage the contract charges at mint, rounded up. The contract takes the
 * exact cost from the deposit and credits the rest to the kat's balance.
 */
export const MINT_STORAGE_ALLOWANCE = 2n * 10n ** 22n;

const yocto = (amount: bigint) => `${amount} yocto` as const;

export class KatContract {
  readonly #near: Near;
  readonly #contractId: string;

  constructor(near: Near, contractId: string) {
    this.#near = near;
    this.#contractId = contractId;
  }

  async getKat(tokenId: string): Promise<KatView | null> {
    return (await this.#view<KatView | null>("get_kat", { token_id: tokenId })) ?? null;
  }

  async getConfig(): Promise<ContractConfig> {
    const config = await this.#view<ContractConfig>("get_config", {});
    if (!config) {
      throw new Error("The contract returned no configuration");
    }
    return config;
  }

  /** Token ids owned by an account, lowest number first. */
  async katsOf(accountId: string): Promise<string[]> {
    const tokens = await this.#view<Array<{ token_id: string }>>("nft_tokens_for_owner", {
      account_id: accountId,
      limit: 100,
    });
    return (tokens ?? []).map((token) => token.token_id).sort((a, b) => Number(a) - Number(b));
  }

  /** Mints a kat to the signer. `startingBalance` funds its first conversations. */
  async mint(mintPrice: bigint, startingBalance: bigint): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "mint",
      {},
      {
        gas: "30 Tgas",
        attachedDeposit: yocto(mintPrice + MINT_STORAGE_ALLOWANCE + startingBalance),
      },
    );
  }

  async fund(tokenId: string, amount: bigint): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "fund",
      { token_id: tokenId },
      { gas: "30 Tgas", attachedDeposit: yocto(amount) },
    );
  }

  async transfer(tokenId: string, receiverId: string): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "nft_transfer",
      { receiver_id: receiverId, token_id: tokenId },
      { gas: "30 Tgas", attachedDeposit: yocto(1n) },
    );
  }

  /** Whether an account holds a given key as a full-access key. */
  async accountHoldsKey(accountId: string, publicKey: string): Promise<boolean> {
    const key = await this.#near.getAccessKey(accountId, publicKey);
    return key !== null && key.permission === "FullAccess";
  }

  // Optimistic finality: the interface should show a transaction's effect at once.
  #view<T>(method: string, args: object): Promise<T | undefined> {
    return this.#near.view<T>(this.#contractId, method, args, { finality: "optimistic" });
  }
}
```

- [ ] **Step 4: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): add context and signature verification, and the contract client"
```

### Task 4: Error messages and the kat components

**Files:**
- Create: `web/src/index.css`
- Create: `web/src/lib/problems.ts`
- Create: `web/src/components/MintPanel.tsx`
- Create: `web/src/components/Chat.tsx`
- Create: `web/src/components/PersonalityEditor.tsx`
- Create: `web/src/components/FundPanel.tsx`
- Create: `web/src/components/GiveAwayPanel.tsx`
- Test: `web/test/problems.test.ts`
- Test: `web/test/components.test.tsx`

**Interfaces:**
- Consumes: `KeeperError`, `ChatReply`, `formatNear`, `parseNear`, `MINT_STORAGE_ALLOWANCE`.
- Produces: `describeProblem(error): string`; components `MintPanel`, `Chat`, `PersonalityEditor`, `FundPanel`, `GiveAwayPanel`, each taking plain callbacks so they can be tested without a wallet or keeper.

The visual language lives in `index.css`: the surface (night sky, NEAR green) for landing and minting, and the burrow (warm earth, lamp gold) for a kat's own page. Fonts follow nearkat.xyz: Archivo Black for headings, Space Grotesk for everything else, monospace only for account ids and hashes. Every error message says what happened and what to do next.

- [ ] **Step 1: Create the supporting files**

`web/src/index.css`:

```css
@import "tailwindcss";
@import "@fontsource/archivo-black/latin-400.css";
@import "@fontsource/space-grotesk/latin-400.css";
@import "@fontsource/space-grotesk/latin-500.css";
@import "@fontsource/space-grotesk/latin-700.css";

/*
 * Two worlds. The surface (landing, minting) is the night sky from
 * nearkat.xyz. The burrow (one kat's page) is warm earth lit by a lamp.
 */
@theme {
  --color-night: #030b11;
  --color-dusk: #0d1c22;
  --color-cream: #f4ecd9;
  --color-mist: #9ca9a6;
  --color-glow: #19f6a1;
  --color-lamp: #f2bd35;
  --color-clay: #c8643a;
  --color-earth: #1c120c;
  --color-soil: #2a1a10;
  --color-root: #4a3323;
  --color-alarm: #ff8a7a;

  --font-display: "Archivo Black", "Arial Black", sans-serif;
  --font-sans: "Space Grotesk", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}

@layer base {
  html {
    background: var(--color-night);
    color: var(--color-cream);
    font-family: var(--font-sans);
    font-weight: 400;
    -webkit-font-smoothing: antialiased;
  }

  body {
    min-height: 100dvh;
  }

  h1,
  h2 {
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }

  :focus-visible {
    outline: 2px solid var(--color-glow);
    outline-offset: 3px;
  }

  ::selection {
    background: var(--color-glow);
    color: var(--color-night);
  }
}

@layer components {
  /* The night sky: a few fixed stars and a faint glow where the sun went down. */
  .surface {
    background:
      radial-gradient(2px 2px at 9% 16%, #f4ecd9 50%, transparent 52%),
      radial-gradient(1.5px 1.5px at 23% 31%, #f4ecd9aa 50%, transparent 52%),
      radial-gradient(2.5px 2.5px at 38% 8%, #f4ecd9 50%, transparent 52%),
      radial-gradient(1.5px 1.5px at 51% 22%, #f4ecd999 50%, transparent 52%),
      radial-gradient(2px 2px at 58% 41%, #f4ecd9cc 50%, transparent 52%),
      radial-gradient(1.5px 1.5px at 67% 11%, #f4ecd9aa 50%, transparent 52%),
      radial-gradient(2px 2px at 93% 27%, #f4ecd9 50%, transparent 52%),
      radial-gradient(1.5px 1.5px at 81% 5%, #f4ecd988 50%, transparent 52%),
      radial-gradient(1.5px 1.5px at 4% 47%, #f4ecd977 50%, transparent 52%),
      radial-gradient(2px 2px at 45% 52%, #19f6a1aa 50%, transparent 52%), var(--color-night);
  }

  /* Underground: darker toward the edges, lit from where the kat sits. */
  .burrow {
    background:
      radial-gradient(90% 70% at 30% 0%, #f2bd3514, transparent 60%),
      radial-gradient(140% 100% at 50% 0%, var(--color-soil), var(--color-earth) 70%);
  }

  .field {
    width: 100%;
    border-radius: 6px;
    border: 1px solid var(--field-line, #f4ecd933);
    background: var(--field-bg, #00000040);
    padding: 0.625rem 0.75rem;
    color: var(--color-cream);
  }

  .field::placeholder {
    color: var(--color-mist);
  }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    padding: 0.625rem 1.125rem;
    font-weight: 700;
    background: var(--button-bg, var(--color-glow));
    color: var(--button-ink, var(--color-night));
    transition: filter 120ms;
  }

  .button:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .button-quiet {
    --button-bg: transparent;
    --button-ink: var(--color-cream);
    border: 1px solid #f4ecd955;
  }

  .button-lamp {
    --button-bg: var(--color-lamp);
    --button-ink: var(--color-earth);
  }
}

/* The one piece of staged motion: arriving in a burrow feels like climbing down. */
@keyframes descend {
  from {
    opacity: 0;
    transform: translateY(-18px);
  }
}

.descend {
  animation: descend 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .descend {
    animation: none;
  }
}
```

- [ ] **Step 2: Write the failing tests**

`web/test/problems.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { KeeperError } from "../src/lib/keeper.ts";
import { describeProblem } from "../src/lib/problems.ts";

describe("describeProblem", () => {
  test.each([
    ["insufficient_balance", /out of NEAR/],
    ["not_owner", /Only this kat's owner/],
    ["waking_up", /still waking up/],
    ["inference_unavailable", /Nothing was charged/],
    ["corrupted", /doesn't match its on-chain record/],
    ["invalid_signature", /approve the message/],
    ["invalid_input", /under 4,000 characters/],
  ])("explains the keeper error %s", (code, expected) => {
    expect(describeProblem(new KeeperError(400, code, "raw"))).toMatch(expected);
  });

  test("falls back to the keeper's own message for a code it does not know", () => {
    expect(describeProblem(new KeeperError(500, "internal", "Internal error"))).toBe(
      "Internal error",
    );
  });

  test.each(["User rejected the request", "Request was cancelled", "Popup closed by user"])(
    "recognises a cancelled wallet request: %s",
    (message) => {
      expect(describeProblem(new Error(message))).toMatch(/cancelled the request/);
    },
  );

  test("never returns an empty message", () => {
    expect(describeProblem(new Error(""))).toMatch(/Something went wrong/);
    expect(describeProblem("plain string")).toBe("plain string");
  });
});
```

`web/test/components.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Chat } from "../src/components/Chat.tsx";
import { FundPanel } from "../src/components/FundPanel.tsx";
import { GiveAwayPanel } from "../src/components/GiveAwayPanel.tsx";
import { MintPanel } from "../src/components/MintPanel.tsx";
import { PersonalityEditor } from "../src/components/PersonalityEditor.tsx";
import { type ChatReply, KeeperError } from "../src/lib/keeper.ts";

const NEAR = 10n ** 24n;
const reply = (text: string, balance = "5"): ChatReply => ({
  reply: text,
  balance,
  verification: {
    chat_id: "c",
    model: "m",
    request_hash: "a",
    response_hash: "b",
    signature: null,
  },
});

describe("MintPanel", () => {
  test("adds the mint price, storage allowance and starting balance", async () => {
    const onMint = vi.fn(async () => {});
    render(<MintPanel mintPrice={NEAR} onMint={onMint} onConnect={() => {}} />);
    expect(screen.getByText("2.02 NEAR")).toBeTruthy();
    expect(screen.getByText(/about 500 messages/)).toBeTruthy();

    const input = screen.getByLabelText("Starting balance");
    await userEvent.clear(input);
    await userEvent.type(input, "0.5");
    expect(screen.getByText("1.52 NEAR")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Mint a kat" }));
    expect(onMint).toHaveBeenCalledWith(NEAR / 2n);
  });

  test("blocks minting and explains when the amount is not a number", async () => {
    const onMint = vi.fn(async () => {});
    render(<MintPanel mintPrice={NEAR} onMint={onMint} onConnect={() => {}} />);
    const input = screen.getByLabelText("Starting balance");
    await userEvent.clear(input);
    await userEvent.type(input, "lots");
    expect(screen.getByText(/Enter an amount in NEAR/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mint a kat" })).toHaveProperty("disabled", true);
  });

  test("offers to connect a wallet instead when none is connected", async () => {
    const onConnect = vi.fn();
    render(<MintPanel mintPrice={NEAR} onMint={null} onConnect={onConnect} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet to mint" }));
    expect(onConnect).toHaveBeenCalled();
  });

  test("says what went wrong when the wallet request is cancelled", async () => {
    const onMint = vi.fn(async () => {
      throw new Error("User rejected the request");
    });
    render(<MintPanel mintPrice={NEAR} onMint={onMint} onConnect={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Mint a kat" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/cancelled the request/);
    expect(screen.getByRole("button", { name: "Mint a kat" })).toHaveProperty("disabled", false);
  });
});

describe("Chat", () => {
  function setup(send: (message: string) => Promise<ChatReply>) {
    const onReply = vi.fn();
    const onOutOfBalance = vi.fn();
    render(
      <Chat katName="Nearkat #1" send={send} onReply={onReply} onOutOfBalance={onOutOfBalance} />,
    );
    return { onReply, onOutOfBalance, box: screen.getByLabelText("Message to Nearkat #1") };
  }

  test("shows the message and the kat's reply, and reports the reply", async () => {
    const send = vi.fn(async () => reply("meow back"));
    const { onReply, box } = setup(send);
    await userEvent.type(box, "hello there");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(send).toHaveBeenCalledWith("hello there");
    expect(await screen.findByText("meow back")).toBeTruthy();
    expect(screen.getByText("hello there")).toBeTruthy();
    expect(onReply).toHaveBeenCalledWith(reply("meow back"));
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  test("sends on Enter and adds a line break on Shift+Enter", async () => {
    const send = vi.fn(async () => reply("ok"));
    const { box } = setup(send);
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two{Enter}");
    await waitFor(() => expect(send).toHaveBeenCalledWith("line one\nline two"));
  });

  test("does not send an empty message", async () => {
    const send = vi.fn(async () => reply("ok"));
    const { box } = setup(send);
    await userEvent.type(box, "   {Enter}");
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
  });

  test("puts an unanswered message back in the box and says why", async () => {
    const send = vi.fn(async () => {
      throw new KeeperError(503, "inference_unavailable", "down");
    });
    const { box, onOutOfBalance } = setup(send);
    await userEvent.type(box, "are you there?{Enter}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing was charged/);
    expect((box as HTMLTextAreaElement).value).toBe("are you there?");
    expect(screen.queryByText("You")).toBeNull();
    expect(onOutOfBalance).not.toHaveBeenCalled();
  });

  test("points at the balance when the kat has run out of NEAR", async () => {
    const send = vi.fn(async () => {
      throw new KeeperError(402, "insufficient_balance", "needs more");
    });
    const { box, onOutOfBalance } = setup(send);
    await userEvent.type(box, "hello{Enter}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/out of NEAR/);
    expect(onOutOfBalance).toHaveBeenCalled();
  });
});

describe("PersonalityEditor", () => {
  test("saves a changed personality and confirms it", async () => {
    const save = vi.fn(async () => {});
    render(<PersonalityEditor personality="curious" save={save} />);
    const button = screen.getByRole("button", { name: "Save personality" });
    expect(button).toHaveProperty("disabled", true);

    const box = screen.getByLabelText("Personality");
    await userEvent.clear(box);
    await userEvent.type(box, "grumpy");
    expect(screen.getByText("6 of 4,000 characters")).toBeTruthy();
    await userEvent.click(button);
    expect(save).toHaveBeenCalledWith("grumpy");
    expect(await screen.findByText("Personality saved.")).toBeTruthy();
    expect(button).toHaveProperty("disabled", true);
  });

  test("will not save an empty or over-long personality", async () => {
    render(<PersonalityEditor personality="curious" save={async () => {}} />);
    const box = screen.getByLabelText("Personality") as HTMLTextAreaElement;
    const button = screen.getByRole("button", { name: "Save personality" });
    await userEvent.clear(box);
    expect(button).toHaveProperty("disabled", true);
    await userEvent.click(box);
    await userEvent.paste("x".repeat(4001));
    expect(screen.getByText("4,001 of 4,000 characters")).toBeTruthy();
    expect(button).toHaveProperty("disabled", true);
  });

  test("keeps the draft and says why when the save fails", async () => {
    const save = vi.fn(async () => {
      throw new KeeperError(402, "insufficient_balance", "needs more");
    });
    render(<PersonalityEditor personality="curious" save={save} />);
    const box = screen.getByLabelText("Personality") as HTMLTextAreaElement;
    await userEvent.type(box, " and bold");
    await userEvent.click(screen.getByRole("button", { name: "Save personality" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/out of NEAR/);
    expect(box.value).toBe("curious and bold");
  });
});

describe("FundPanel", () => {
  test("shows the balance and adds the entered amount", async () => {
    const fund = vi.fn(async () => {});
    render(<FundPanel balance={NEAR + NEAR / 4n} urgent={false} fund={fund} />);
    expect(screen.getByText("1.25")).toBeTruthy();
    const input = screen.getByLabelText("NEAR to add");
    await userEvent.clear(input);
    await userEvent.type(input, "2");
    await userEvent.click(screen.getByRole("button", { name: "Add NEAR" }));
    expect(fund).toHaveBeenCalledWith(2n * NEAR);
  });

  test.each(["0", "", "abc"])("will not add %j", async (text) => {
    render(<FundPanel balance={NEAR} urgent={false} fund={async () => {}} />);
    const input = screen.getByLabelText("NEAR to add");
    await userEvent.clear(input);
    if (text) {
      await userEvent.type(input, text);
    }
    expect(screen.getByRole("button", { name: "Add NEAR" })).toHaveProperty("disabled", true);
  });
});

describe("GiveAwayPanel", () => {
  test("asks for confirmation before giving the kat away", async () => {
    const give = vi.fn(async () => {});
    render(<GiveAwayPanel katName="Nearkat #1" give={give} />);
    await userEvent.type(screen.getByLabelText("Account to give Nearkat #1 to"), "bob.near");
    await userEvent.click(screen.getByRole("button", { name: "Give Nearkat #1 away" }));
    expect(give).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Yes, give Nearkat #1 to bob.near" }));
    expect(give).toHaveBeenCalledWith("bob.near");
  });

  test("lets the owner back out at the confirmation step", async () => {
    const give = vi.fn(async () => {});
    render(<GiveAwayPanel katName="Nearkat #1" give={give} />);
    await userEvent.type(screen.getByLabelText("Account to give Nearkat #1 to"), "bob.near");
    await userEvent.click(screen.getByRole("button", { name: "Give Nearkat #1 away" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Give Nearkat #1 away" })).toBeTruthy();
    expect(give).not.toHaveBeenCalled();
  });

  test.each(["", "B", "Bob.near", "bob..near", "bob near", "a".repeat(65)])(
    "will not give to the invalid account %j",
    async (account) => {
      render(<GiveAwayPanel katName="Nearkat #1" give={async () => {}} />);
      if (account) {
        await userEvent.type(screen.getByLabelText("Account to give Nearkat #1 to"), account);
      }
      expect(screen.getByRole("button", { name: "Give Nearkat #1 away" })).toHaveProperty(
        "disabled",
        true,
      );
    },
  );

  test("accepts an implicit 64-character account", async () => {
    render(<GiveAwayPanel katName="Nearkat #1" give={async () => {}} />);
    await userEvent.type(screen.getByLabelText("Account to give Nearkat #1 to"), "a1".repeat(32));
    expect(screen.getByRole("button", { name: "Give Nearkat #1 away" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because the modules they import do not exist yet; earlier test files still pass.

- [ ] **Step 4: Implement**

`web/src/lib/problems.ts`:

```typescript
import { KeeperError } from "./keeper.ts";

/** Turns any failure into one sentence that says what happened and what to do. */
export function describeProblem(error: unknown): string {
  if (error instanceof KeeperError) {
    switch (error.code) {
      case "insufficient_balance":
        return "This kat is out of NEAR. Add some to its balance to keep going.";
      case "not_owner":
        return "Only this kat's owner can do that. Check which wallet is connected.";
      case "waking_up":
        return "This kat is still waking up. Try again in a few seconds.";
      case "inference_unavailable":
        return "The kat can't think right now. Nothing was charged. Try again in a moment.";
      case "corrupted":
        return "This kat's stored mind doesn't match its on-chain record, so the keeper won't open it.";
      case "unreachable":
        return error.message;
      case "invalid_signature":
      case "invalid_nonce":
        return "Sign-in didn't go through. Try again, and approve the message in your wallet.";
      case "too_large":
      case "invalid_input":
        return "That's too long. Keep it under 4,000 characters.";
      default:
        return error.message;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|cancel|denied|closed/i.test(message)) {
    return "You cancelled the request in your wallet. Nothing was sent.";
  }
  return message || "Something went wrong. Try again.";
}
```

`web/src/components/MintPanel.tsx`:

```tsx
import { type FormEvent, useState } from "react";
import { MINT_STORAGE_ALLOWANCE } from "../lib/contract.ts";
import { formatNear, parseNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";

/** What one chat message costs, for the "about N messages" hint. */
const CHAT_PRICE = 2n * 10n ** 21n;

export interface MintPanelProps {
  mintPrice: bigint;
  /** Null while no wallet is connected. */
  onMint: ((startingBalance: bigint) => Promise<void>) | null;
  onConnect: () => void;
}

export function MintPanel({ mintPrice, onMint, onConnect }: MintPanelProps) {
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const startingBalance = parseNear(amount);
  const total =
    startingBalance === null ? null : mintPrice + MINT_STORAGE_ALLOWANCE + startingBalance;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!onMint || startingBalance === null) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onMint(startingBalance);
    } catch (error) {
      setProblem(describeProblem(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-cream/15 bg-dusk/80 p-6 backdrop-blur"
    >
      <h2 className="text-2xl">Mint a kat</h2>
      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-mist">Mint price</dt>
          <dd>{formatNear(mintPrice)} NEAR</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt>
            <label htmlFor="starting-balance" className="text-mist">
              Starting balance
            </label>
          </dt>
          <dd className="flex items-center gap-2">
            <input
              id="starting-balance"
              className="field w-24 text-right"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-describedby="starting-balance-hint"
              aria-invalid={startingBalance === null}
            />
            NEAR
          </dd>
        </div>
      </dl>
      <p id="starting-balance-hint" className="mt-2 text-sm text-mist">
        {startingBalance === null
          ? "Enter an amount in NEAR, like 1 or 0.5."
          : `Pays for about ${startingBalance / CHAT_PRICE} messages. It stays with the kat, even if you give it away.`}
      </p>
      <div className="mt-5 flex items-baseline justify-between border-t border-cream/15 pt-4">
        <span className="text-mist">You pay</span>
        <span className="text-xl font-bold">
          {total === null ? "…" : `${formatNear(total)} NEAR`}
        </span>
      </div>
      {onMint ? (
        <button type="submit" className="button mt-5 w-full" disabled={busy || total === null}>
          {busy ? "Minting…" : "Mint a kat"}
        </button>
      ) : (
        <button type="button" className="button mt-5 w-full" onClick={onConnect}>
          Connect wallet to mint
        </button>
      )}
      {problem && (
        <p role="alert" className="mt-3 text-sm text-alarm">
          {problem}
        </p>
      )}
    </form>
  );
}
```

`web/src/components/Chat.tsx`:

```tsx
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type ChatReply, KeeperError } from "../lib/keeper.ts";
import { describeProblem } from "../lib/problems.ts";

interface Line {
  from: "you" | "kat";
  text: string;
}

export interface ChatProps {
  katName: string;
  send: (message: string) => Promise<ChatReply>;
  /** Called after each reply, with the kat's new balance and the proof for that reply. */
  onReply: (reply: ChatReply) => void;
  /** Called when the kat has run out of NEAR. */
  onOutOfBalance: () => void;
}

const MAX_CHARS = 4000;

export function Chat({ katName, send, onReply, onOutOfBalance }: ChatProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [lines.length, thinking]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || thinking) {
      return;
    }
    setThinking(true);
    setProblem(null);
    setLines((current) => [...current, { from: "you", text: message }]);
    setDraft("");
    try {
      const reply = await send(message);
      setLines((current) => [...current, { from: "kat", text: reply.reply }]);
      onReply(reply);
    } catch (error) {
      // The message was not answered, so it goes back into the box to resend.
      setLines((current) => current.slice(0, -1));
      setDraft(message);
      setProblem(describeProblem(error));
      if (error instanceof KeeperError && error.code === "insufficient_balance") {
        onOutOfBalance();
      }
    } finally {
      setThinking(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <section aria-label={`Conversation with ${katName}`} className="flex min-h-[28rem] flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto pr-1" aria-live="polite">
        {lines.length === 0 && !thinking && (
          <p className="max-w-prose text-mist">
            Say something to {katName}. Each message costs 0.002 NEAR from its balance.
          </p>
        )}
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are only ever appended.
          <div key={index} className={line.from === "you" ? "pl-10 sm:pl-24" : "pr-10 sm:pr-24"}>
            <p className="mb-1 text-sm text-mist">{line.from === "you" ? "You" : katName}</p>
            <p
              className={`whitespace-pre-wrap rounded-lg px-4 py-3 leading-relaxed ${
                line.from === "you" ? "bg-root/60" : "bg-black/35 text-cream"
              }`}
            >
              {line.text}
            </p>
          </div>
        ))}
        {thinking && <p className="text-sm text-lamp">{katName} is thinking…</p>}
        <div ref={end} />
      </div>
      {problem && (
        <p role="alert" className="mt-4 text-sm text-alarm">
          {problem}
        </p>
      )}
      <form onSubmit={submit} className="mt-4 flex items-end gap-3">
        <label htmlFor="chat-message" className="sr-only">
          Message to {katName}
        </label>
        <textarea
          id="chat-message"
          className="field min-h-[3rem] flex-1 resize-y"
          rows={2}
          maxLength={MAX_CHARS}
          placeholder={`Message ${katName}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={thinking}
        />
        <button type="submit" className="button button-lamp" disabled={thinking || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
```

`web/src/components/PersonalityEditor.tsx`:

```tsx
import { type FormEvent, useState } from "react";
import { describeProblem } from "../lib/problems.ts";

const MAX_CHARS = 4000;

export interface PersonalityEditorProps {
  personality: string;
  save: (prompt: string) => Promise<void>;
}

export function PersonalityEditor({ personality, save }: PersonalityEditorProps) {
  const [draft, setDraft] = useState(personality);
  const [saved, setSaved] = useState(personality);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const changed = draft !== saved;
  const valid = draft.trim().length > 0 && draft.length <= MAX_CHARS;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("saving");
    setProblem(null);
    try {
      await save(draft);
      setSaved(draft);
      setState("saved");
    } catch (error) {
      setProblem(describeProblem(error));
      setState("idle");
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="personality" className="block text-lg font-bold">
        Personality
      </label>
      <p id="personality-hint" className="mt-1 text-sm text-mist">
        Describe who this kat is. It reads this before every reply.
      </p>
      <textarea
        id="personality"
        className="field mt-3 min-h-[11rem] resize-y leading-relaxed"
        aria-describedby="personality-hint personality-count"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setState("idle");
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span
          id="personality-count"
          className={`text-sm ${draft.length > MAX_CHARS ? "text-alarm" : "text-mist"}`}
        >
          {draft.length.toLocaleString("en-US")} of 4,000 characters
        </span>
        <button
          type="submit"
          className="button button-lamp"
          disabled={!changed || !valid || state === "saving"}
        >
          {state === "saving" ? "Saving…" : "Save personality"}
        </button>
      </div>
      <p className="mt-2 text-sm text-mist" aria-live="polite">
        {state === "saved" && !changed
          ? "Personality saved."
          : "Saving costs 0.05 NEAR from the kat's balance."}
      </p>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-alarm">
          {problem}
        </p>
      )}
    </form>
  );
}
```

`web/src/components/FundPanel.tsx`:

```tsx
import { type FormEvent, useState } from "react";
import { formatNear, parseNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";

export interface FundPanelProps {
  balance: bigint;
  /** Draws attention to the panel after the kat ran out of NEAR. */
  urgent: boolean;
  fund: (amount: bigint) => Promise<void>;
}

export function FundPanel({ balance, urgent, fund }: FundPanelProps) {
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const parsed = parseNear(amount);
  const valid = parsed !== null && parsed > 0n;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await fund(parsed);
    } catch (error) {
      setProblem(describeProblem(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={urgent ? "rounded-lg outline outline-2 outline-offset-8 outline-lamp" : undefined}
    >
      <h3 className="text-lg font-bold">Balance</h3>
      <p className="mt-1">
        <span className="text-2xl font-bold">{formatNear(balance)}</span> NEAR
      </p>
      <p className="mt-1 text-sm text-mist">
        Pays for messages and memory. It stays with the kat and can't be withdrawn.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <label htmlFor="fund-amount" className="sr-only">
          NEAR to add
        </label>
        <input
          id="fund-amount"
          className="field w-24 text-right"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={!valid}
        />
        <button type="submit" className="button button-quiet" disabled={busy || !valid}>
          {busy ? "Adding…" : "Add NEAR"}
        </button>
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-alarm">
          {problem}
        </p>
      )}
    </form>
  );
}
```

`web/src/components/GiveAwayPanel.tsx`:

```tsx
import { type FormEvent, useState } from "react";
import { describeProblem } from "../lib/problems.ts";

export interface GiveAwayPanelProps {
  katName: string;
  give: (receiverId: string) => Promise<void>;
}

/** NEAR account ids: 2 to 64 characters of lowercase letters, digits and . _ - separators. */
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+([._-][a-z0-9]+)*$/;

export function GiveAwayPanel({ katName, give }: GiveAwayPanelProps) {
  const [receiver, setReceiver] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const valid = ACCOUNT_ID.test(receiver.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) {
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await give(receiver.trim());
    } catch (error) {
      setProblem(describeProblem(error));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h3 className="text-lg font-bold">Give away</h3>
      <p className="mt-1 text-sm text-mist">
        {katName} keeps its personality, memories and balance. You lose access.
      </p>
      <label htmlFor="receiver" className="sr-only">
        Account to give {katName} to
      </label>
      <input
        id="receiver"
        className="field mt-3 font-mono text-sm"
        placeholder="friend.near"
        autoComplete="off"
        spellCheck={false}
        value={receiver}
        onChange={(event) => {
          setReceiver(event.target.value);
          setConfirming(false);
        }}
      />
      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="button"
            style={{
              ["--button-bg" as string]: "var(--color-clay)",
              ["--button-ink" as string]: "var(--color-cream)",
            }}
            disabled={busy}
          >
            {busy ? "Giving…" : `Yes, give ${katName} to ${receiver.trim()}`}
          </button>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            Keep it
          </button>
        </div>
      ) : (
        <button type="submit" className="button button-quiet mt-3" disabled={!valid}>
          Give {katName} away
        </button>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-alarm">
          {problem}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 5: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): add error messages and the mint, chat, personality, fund and give-away components"
```

### Task 5: Wallet, pages and entry point

**Files:**
- Create: `web/src/wallet/backend.ts`
- Create: `web/src/wallet/WalletProvider.tsx`
- Create: `web/src/lib/useAsync.ts`
- Create: `web/src/lib/proof.ts`
- Create: `web/src/services.tsx`
- Create: `web/src/components/KatBadge.tsx`
- Create: `web/src/components/Horizon.tsx`
- Create: `web/src/components/Shell.tsx`
- Create: `web/src/pages/Home.tsx`
- Create: `web/src/pages/Kat.tsx`
- Create: `web/src/pages/Verify.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/main.tsx`
- Create: `web/.env.example`

**Interfaces:**
- Consumes: everything from Tasks 1 to 4.
- Produces: `WalletBackend` with `connectorBackend(config)` and `devBackend(config)`; `WalletProvider`, `useWallet()`; `ServicesProvider`, `useServices()`; `useAsync(key, load)`; `rememberProof`, `recallProof`; pages `Home`, `Kat`, `Verify`; `App({ config, backend })`.

These files are wiring and layout, and have no unit tests: the gate for this task is the type-checker, the linter and a production build, and Task 6 drives all of it in a browser. Two things to know. The dev wallet signs with a fixed key so the browser test can run without a wallet extension; it is refused on mainnet. And the keeper trails the chain by a few seconds, so after a mint or transfer the kat page waits and retries instead of showing "not found" or "not the owner".

- [ ] **Step 1: Write the files**

`web/src/wallet/backend.ts`:

```typescript
import { NearConnector } from "@hot-labs/near-connect";
import { fromNearConnect, Near, type PrivateKey } from "near-kit";
import type { AppConfig } from "../lib/config.ts";

/** Where signatures come from: a browser wallet, or a fixed key in tests. */
export interface WalletBackend {
  /** The account of an existing connection, if there is one. */
  restore(): Promise<string | null>;
  /** Asks the user to connect. Resolves with the connected account. */
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  /** A client that signs as the connected account. */
  near(): Near;
}

/** Browser wallets through NEAR Connect. */
export function connectorBackend(config: AppConfig): WalletBackend {
  if (typeof config.network !== "string") {
    throw new Error("Browser wallets need testnet or mainnet; use the dev wallet for a sandbox");
  }
  const network = config.network;
  // Only wallets that can sign the keeper's sign-in message are offered.
  const connector = new NearConnector({ network, features: { signMessage: true } });
  const currentAccount = async () => {
    const wallet = await connector.wallet();
    const [account] = await wallet.getAccounts();
    return account?.accountId ?? null;
  };
  // One client for the life of a connection, so everything built on it stays stable.
  let client: Near | null = null;
  return {
    restore: () => currentAccount().catch(() => null),
    async connect() {
      await connector.connect();
      const accountId = await currentAccount();
      if (!accountId) {
        throw new Error("The wallet did not share an account");
      }
      return accountId;
    },
    async disconnect() {
      client = null;
      await connector.disconnect();
    },
    near: () => {
      client ??= new Near({ network, wallet: fromNearConnect(connector) });
      return client;
    },
  };
}

/** Signs with a fixed key. For automated tests against a sandbox or testnet. */
export function devBackend(config: AppConfig): WalletBackend {
  const dev = config.devWallet;
  if (!dev) {
    throw new Error("No dev wallet is configured");
  }
  const near = new Near({
    network: config.network,
    privateKey: dev.privateKey as PrivateKey,
    defaultSignerId: dev.accountId,
  });
  // Remembered for the tab, so a reload stays connected like a real wallet would.
  const flag = "nearkat.dev-wallet.connected";
  return {
    restore: async () => (sessionStorage.getItem(flag) ? dev.accountId : null),
    async connect() {
      sessionStorage.setItem(flag, "1");
      return dev.accountId;
    },
    async disconnect() {
      sessionStorage.removeItem(flag);
    },
    near: () => near,
  };
}
```

`web/src/wallet/WalletProvider.tsx`:

```tsx
import type { Near } from "near-kit";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { WalletBackend } from "./backend.ts";

export interface WalletState {
  /** "restoring" until we know whether a wallet was already connected. */
  status: "restoring" | "disconnected" | "connected";
  accountId: string | null;
  /** Signs as the connected account. Null while disconnected. */
  near: Near | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({
  backend,
  children,
}: {
  backend: WalletBackend;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<WalletState["status"]>("restoring");
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    backend.restore().then((restored) => {
      if (current) {
        setAccountId(restored);
        setStatus(restored ? "connected" : "disconnected");
      }
    });
    return () => {
      current = false;
    };
  }, [backend]);

  const connect = useCallback(async () => {
    setAccountId(await backend.connect());
    setStatus("connected");
  }, [backend]);

  const disconnect = useCallback(async () => {
    await backend.disconnect();
    setAccountId(null);
    setStatus("disconnected");
  }, [backend]);

  const near = status === "connected" ? backend.near() : null;
  return (
    <WalletContext.Provider value={{ status, accountId, near, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const wallet = useContext(WalletContext);
  if (!wallet) {
    throw new Error("useWallet must be used inside a WalletProvider");
  }
  return wallet;
}
```

`web/src/lib/useAsync.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";

export type Async<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: unknown };

/**
 * Loads a value when `key` changes. `reload` loads it again in the
 * background, keeping the current value on screen until the new one arrives.
 * Pass a null key to wait.
 */
export function useAsync<T>(
  key: string | null,
  load: () => Promise<T>,
): [Async<T>, () => Promise<void>] {
  const [state, setState] = useState<Async<T>>({ status: "loading" });
  const [version, setVersion] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` is a fresh closure each render; `key` says when to reload.
  useEffect(() => {
    if (key === null) {
      return;
    }
    let current = true;
    if (version === 0) {
      setState({ status: "loading" });
    }
    load().then(
      (data) => current && setState({ status: "ready", data }),
      (error) => current && setState({ status: "error", error }),
    );
    return () => {
      current = false;
    };
  }, [key, version]);

  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  return [state, reload];
}
```

`web/src/lib/proof.ts`:

```typescript
import type { Verification } from "./keeper.ts";

const key = (tokenId: string) => `nearkat.proof.${tokenId}`;

/** Remembers the proof that came with a kat's latest reply, for the verify page. */
export function rememberProof(tokenId: string, verification: Verification): void {
  sessionStorage.setItem(key(tokenId), JSON.stringify(verification));
}

export function recallProof(tokenId: string): Verification | null {
  try {
    return JSON.parse(sessionStorage.getItem(key(tokenId)) ?? "null") as Verification | null;
  } catch {
    return null;
  }
}
```

`web/src/services.tsx`:

```tsx
import { Near } from "near-kit";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { AppConfig } from "./lib/config.ts";
import { KatContract } from "./lib/contract.ts";
import { createKeeper, type Keeper } from "./lib/keeper.ts";
import { KeeperSession } from "./lib/session.ts";
import { useWallet } from "./wallet/WalletProvider.tsx";

export interface Services {
  config: AppConfig;
  keeper: Keeper;
  /** Reads the contract without a wallet. */
  contract: KatContract;
  /** Sends transactions as the connected account. Null while disconnected. */
  signer: KatContract | null;
  /** Calls the keeper as the connected account. Null while disconnected. */
  session: KeeperSession | null;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  const wallet = useWallet();
  const base = useMemo(
    () => ({
      config,
      keeper: createKeeper(config.keeperUrl),
      contract: new KatContract(new Near({ network: config.network }), config.contractId),
    }),
    [config],
  );
  const { near, accountId } = wallet;
  const services = useMemo<Services>(() => {
    if (!near || !accountId) {
      return { ...base, signer: null, session: null };
    }
    return {
      ...base,
      signer: new KatContract(near, config.contractId),
      session: new KeeperSession({
        keeper: base.keeper,
        accountId,
        signMessage: (params) => near.signMessage(params),
      }),
    };
  }, [base, near, accountId, config.contractId]);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error("useServices must be used inside a ServicesProvider");
  }
  return services;
}
```

`web/src/components/KatBadge.tsx`:

```tsx
const RIMS = ["var(--color-glow)", "var(--color-lamp)", "var(--color-clay)", "var(--color-cream)"];

/**
 * Stands in for a kat's portrait until the artwork exists: the mouth of its
 * burrow, with its number, rimmed in one of four colours chosen by its id.
 */
export function KatBadge({ tokenId, size = 72 }: { tokenId: string; size?: number }) {
  const rim = RIMS[Number(tokenId) % RIMS.length] ?? RIMS[0];
  return (
    <span
      role="img"
      aria-label={`Nearkat ${tokenId}`}
      className="inline-grid shrink-0 place-items-center rounded-full font-display text-cream"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background:
          "radial-gradient(circle at 50% 62%, #000 38%, var(--color-soil) 39%, var(--color-root) 100%)",
        boxShadow: `0 0 0 2px ${rim}, 0 0 ${size * 0.3}px -4px ${rim}`,
      }}
    >
      {tokenId}
    </span>
  );
}
```

`web/src/components/Horizon.tsx`:

```tsx
/**
 * The surface at night: the savanna horizon, an acacia, and one kat standing
 * sentry on its mound. Decorative, so it is hidden from assistive technology.
 */
export function Horizon() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[46vh] min-h-64 w-full"
      viewBox="0 0 1440 360"
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        <linearGradient id="afterglow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#19f6a1" stopOpacity="0" />
          <stop offset="0.72" stopColor="#19f6a1" stopOpacity="0.16" />
          <stop offset="1" stopColor="#19f6a1" stopOpacity="0.3" />
        </linearGradient>
        <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#19f6a1" stopOpacity="0.5" />
          <stop offset="1" stopColor="#19f6a1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="300" fill="url(#afterglow)" />
      <ellipse cx="1068" cy="150" rx="150" ry="120" fill="url(#halo)" />
      <g fill="#01060a">
        {/* acacia */}
        <path d="M150 214c34-30 62-40 118-40s92 12 122 40c-40-10-76-13-120-13s-80 3-120 13Z" />
        <path d="M262 198l-7 96h17l-5-96Z" />
        <path d="M264 232c18-10 34-22 46-34l5 4c-12 16-28 30-49 42Z" />
        {/* ground */}
        <path d="M0 292c180-14 330-6 520-10s330 10 520 2 250-12 400-4v80H0Z" />
        {/* mound */}
        <path d="M940 290c26-52 62-112 128-112s104 60 132 112Z" />
        {/* the sentry */}
        <path d="M1049 180c-6-24-2-48 7-64 3-6 19-6 22 0 9 16 13 40 7 64Z" />
        <circle cx="1067" cy="104" r="14" />
        <ellipse cx="1055" cy="108" rx="8" ry="5.5" />
        <circle cx="1060" cy="93" r="4" />
        <circle cx="1075" cy="93" r="4" />
      </g>
      <path
        d="M1080 174c22 6 32-8 24-22"
        fill="none"
        stroke="#01060a"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* the one lit thing on the page: its eye catching the light */}
      <circle cx="1061" cy="103" r="2.2" fill="#19f6a1" />
    </svg>
  );
}
```

`web/src/components/Shell.tsx`:

```tsx
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { shorten } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import { useWallet } from "../wallet/WalletProvider.tsx";
import { Horizon } from "./Horizon.tsx";

function WalletButton() {
  const wallet = useWallet();
  const [problem, setProblem] = useState<string | null>(null);
  if (wallet.status === "restoring") {
    return <span className="text-sm text-mist">Checking wallet</span>;
  }
  if (wallet.status === "connected" && wallet.accountId) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-cream" title={wallet.accountId}>
          {shorten(wallet.accountId, 10)}
        </span>
        <button type="button" className="button button-quiet" onClick={() => wallet.disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {problem && (
        <span role="alert" className="max-w-xs text-right text-sm text-alarm">
          {problem}
        </span>
      )}
      <button
        type="button"
        className="button"
        onClick={() => {
          setProblem(null);
          wallet.connect().catch((error) => setProblem(describeProblem(error)));
        }}
      >
        Connect wallet
      </button>
    </div>
  );
}

/** The frame around every page. `world` picks the surface or the burrow backdrop. */
export function Shell({ world, children }: { world: "surface" | "burrow"; children: ReactNode }) {
  return (
    <div className={`${world} relative isolate min-h-dvh overflow-hidden`}>
      {world === "surface" && <Horizon />}
      <header className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
        <Link to="/" className="font-display text-xl text-cream">
          Nearkat burrow
        </Link>
        <WalletButton />
      </header>
      <main className="relative mx-auto max-w-6xl px-5 pb-24">{children}</main>
    </div>
  );
}
```

`web/src/pages/Home.tsx`:

```tsx
import { Link, useNavigate } from "react-router";
import { KatBadge } from "../components/KatBadge.tsx";
import { MintPanel } from "../components/MintPanel.tsx";
import { Shell } from "../components/Shell.tsx";
import { describeProblem } from "../lib/problems.ts";
import { useAsync } from "../lib/useAsync.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

export function Home() {
  const wallet = useWallet();
  const { contract, signer } = useServices();
  const navigate = useNavigate();
  const [config] = useAsync("config", () => contract.getConfig());
  const [kats, reloadKats] = useAsync(wallet.accountId, () =>
    contract.katsOf(wallet.accountId as string),
  );

  async function mint(mintPrice: bigint, startingBalance: bigint) {
    if (!signer || !wallet.accountId) {
      return;
    }
    const before = await contract.katsOf(wallet.accountId);
    await signer.mint(mintPrice, startingBalance);
    const after = await contract.katsOf(wallet.accountId);
    await reloadKats();
    const minted = after.find((id) => !before.includes(id));
    if (minted) {
      navigate(`/kat/${minted}`);
    }
  }

  return (
    <Shell world="surface">
      <div className="grid gap-12 pt-10 lg:grid-cols-[1.25fr_1fr] lg:items-start lg:pt-20">
        <div>
          <h1 className="text-5xl leading-[1.02] sm:text-7xl">
            Raise a kat.
            <br />
            Give it away.
            <br />
            It remembers.
          </h1>
          <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-mist">
            Every nearkat is an NFT with a mind of its own. Shape its personality, talk to it, and
            when you hand it to someone else, its memories go with it. Only the kat's owner can read
            its mind.
          </p>
        </div>
        {config.status === "ready" ? (
          <MintPanel
            mintPrice={BigInt(config.data.mint_price)}
            onMint={signer ? (balance) => mint(BigInt(config.data.mint_price), balance) : null}
            onConnect={() => void wallet.connect().catch(() => undefined)}
          />
        ) : (
          <p className="rounded-xl border border-cream/15 bg-dusk/80 p-6 text-mist" role="status">
            {config.status === "loading"
              ? "Reading the contract…"
              : `Can't read the contract. ${describeProblem(config.error)}`}
          </p>
        )}
      </div>

      {wallet.status === "connected" && (
        <section className="mt-20" aria-labelledby="mob">
          <h2 id="mob" className="text-3xl">
            Your mob
          </h2>
          {kats.status === "loading" && <p className="mt-4 text-mist">Looking for your kats…</p>}
          {kats.status === "error" && (
            <p className="mt-4 text-alarm" role="alert">
              Can't list your kats. {describeProblem(kats.error)}
            </p>
          )}
          {kats.status === "ready" && kats.data.length === 0 && (
            <p className="mt-4 text-mist">No kats in this wallet yet. Mint your first one above.</p>
          )}
          {kats.status === "ready" && kats.data.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-6">
              {kats.data.map((id) => (
                <li key={id}>
                  <Link to={`/kat/${id}`} className="group flex items-center gap-3">
                    <KatBadge tokenId={id} />
                    <span className="font-bold group-hover:text-glow">Nearkat #{id}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Shell>
  );
}
```

`web/src/pages/Kat.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Chat } from "../components/Chat.tsx";
import { FundPanel } from "../components/FundPanel.tsx";
import { GiveAwayPanel } from "../components/GiveAwayPanel.tsx";
import { KatBadge } from "../components/KatBadge.tsx";
import { PersonalityEditor } from "../components/PersonalityEditor.tsx";
import { Shell } from "../components/Shell.tsx";
import { shorten } from "../lib/format.ts";
import { KeeperError } from "../lib/keeper.ts";
import { describeProblem } from "../lib/problems.ts";
import { rememberProof } from "../lib/proof.ts";
import { useAsync } from "../lib/useAsync.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

/** How long to wait for the keeper to catch up with the chain before showing an error. */
const SETTLE_WAIT_MS = 2000;
const SETTLE_WAITS = 30;
/** Keeper answers that mean "not yet" when the contract already shows this wallet as owner. */
const SETTLING_CODES = ["waking_up", "not_owner", "not_found"];

/** The owner's side of the page: the conversation, and the panel that shapes the kat. */
function Den({ tokenId, chainBalance }: { tokenId: string; chainBalance: bigint }) {
  const { keeper, signer, session } = useServices();
  const navigate = useNavigate();
  const name = `Nearkat #${tokenId}`;
  const [context, reloadContext] = useAsync(session ? tokenId : null, () =>
    // Reads go through the session so the wallet is asked to sign in once.
    (session as NonNullable<typeof session>).call((token) => keeper.getContext(token, tokenId)),
  );
  // The keeper reports the balance after unsettled charges; the chain lags behind it.
  const [balance, setBalance] = useState(chainBalance);
  const [outOfBalance, setOutOfBalance] = useState(false);

  // The contract already says this wallet owns the kat. If the keeper disagrees
  // or the kat has no mind yet, the keeper is a few seconds behind the chain
  // (after a transfer or a mint), so wait for it instead of raising an alarm.
  const behind =
    context.status === "error" &&
    context.error instanceof KeeperError &&
    SETTLING_CODES.includes(context.error.code)
      ? context.error.code
      : null;
  const [waits, setWaits] = useState(0);
  const settling = behind !== null && waits < SETTLE_WAITS;
  useEffect(() => {
    // Each failed attempt bumps `waits`, which schedules the next one.
    if (behind === null || waits >= SETTLE_WAITS) {
      return;
    }
    const timer = setTimeout(() => {
      setWaits((count) => count + 1);
      void reloadContext();
    }, SETTLE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [behind, waits, reloadContext]);

  if (!session || !signer) {
    return null;
  }
  if (settling) {
    return (
      <p className="mt-10 text-lamp" role="status">
        {behind === "waking_up"
          ? `${name} is waking up. This takes a few seconds.`
          : `The keeper is catching up with the chain. ${name} will be here in a few seconds.`}
      </p>
    );
  }
  if (context.status === "loading") {
    return (
      <p className="mt-10 text-mist">
        Approve the sign-in message in your wallet to open {name}'s mind.
      </p>
    );
  }
  if (context.status === "error") {
    return (
      <div className="mt-10" role="alert">
        <p className="text-alarm">{describeProblem(context.error)}</p>
        <button
          type="button"
          className="button button-quiet mt-4"
          onClick={() => {
            setWaits(0);
            void reloadContext();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-10 grid gap-12 lg:grid-cols-[1.5fr_1fr]">
      <Chat
        katName={name}
        send={(message) => session.call((token) => keeper.chat(token, tokenId, message))}
        onReply={(reply) => {
          setBalance(BigInt(reply.balance));
          setOutOfBalance(false);
          rememberProof(tokenId, reply.verification);
          // A long conversation may have just been folded into memory.
          void reloadContext();
        }}
        onOutOfBalance={() => setOutOfBalance(true)}
      />
      <aside className="space-y-10 lg:border-l lg:border-cream/10 lg:pl-10">
        <PersonalityEditor
          key={context.data.version}
          personality={context.data.personality}
          save={async (prompt) => {
            await session.call((token) => keeper.setPersonality(token, tokenId, prompt));
            setBalance((current) => current - 5n * 10n ** 22n);
          }}
        />
        <section aria-labelledby="memory">
          <h3 id="memory" className="text-lg font-bold">
            Memory
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-mist">
            {context.data.memory_summary ||
              "Nothing remembered yet. After a longer conversation, the kat writes down what mattered."}
          </p>
        </section>
        <FundPanel
          balance={balance}
          urgent={outOfBalance}
          fund={async (amount) => {
            await signer.fund(tokenId, amount);
            setBalance((current) => current + amount);
            setOutOfBalance(false);
          }}
        />
        <GiveAwayPanel
          katName={name}
          give={async (receiverId) => {
            await signer.transfer(tokenId, receiverId);
            navigate("/");
          }}
        />
      </aside>
    </div>
  );
}

export function Kat() {
  const { id = "" } = useParams();
  const wallet = useWallet();
  const { contract } = useServices();
  const [kat] = useAsync(id, () => contract.getKat(id));
  const name = `Nearkat #${id}`;

  return (
    <Shell world="burrow">
      <div className="descend">
        <Link to="/" className="text-sm text-mist underline-offset-4 hover:underline">
          Back to the surface
        </Link>
        {kat.status === "loading" && <p className="mt-10 text-mist">Climbing down…</p>}
        {kat.status === "error" && (
          <p className="mt-10 text-alarm" role="alert">
            Can't read this kat from the contract. {describeProblem(kat.error)}
          </p>
        )}
        {kat.status === "ready" && !kat.data && (
          <div className="mt-10">
            <h1 className="text-4xl">This burrow is empty</h1>
            <p className="mt-3 text-mist">There is no {name}. It may not have been minted yet.</p>
          </div>
        )}
        {kat.status === "ready" && kat.data && (
          <>
            <header className="mt-6 flex flex-wrap items-center gap-5">
              <KatBadge tokenId={id} size={88} />
              <div>
                <h1 className="text-4xl sm:text-5xl">{name}</h1>
                <p className="mt-2 text-sm text-mist">
                  Owned by{" "}
                  <span className="font-mono text-cream" title={kat.data.owner_id}>
                    {shorten(kat.data.owner_id, 12)}
                  </span>
                  <Link
                    to={`/kat/${id}/verify`}
                    className="ml-4 text-lamp underline underline-offset-4"
                  >
                    Verify this kat
                  </Link>
                </p>
              </div>
            </header>
            {wallet.accountId === kat.data.owner_id ? (
              <Den tokenId={id} chainBalance={BigInt(kat.data.balance)} />
            ) : (
              <p className="mt-10 max-w-prose text-mist">
                {wallet.status === "connected"
                  ? `Only its owner can talk to ${name} or read its mind. The connected wallet isn't the owner.`
                  : `Only its owner can talk to ${name} or read its mind. Connect the wallet that owns it.`}
              </p>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
```

`web/src/pages/Verify.tsx`:

```tsx
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Shell } from "../components/Shell.tsx";
import { describeProblem } from "../lib/problems.ts";
import { recallProof } from "../lib/proof.ts";
import { useAsync } from "../lib/useAsync.ts";
import { checkSignature, contextHash } from "../lib/verify.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

type Verdict = "pass" | "fail" | "unknown";

const MARK: Record<Verdict, { label: string; className: string }> = {
  pass: { label: "Checked", className: "bg-glow text-night" },
  fail: { label: "Failed", className: "bg-alarm text-night" },
  unknown: { label: "Not checked", className: "border border-cream/40 text-cream" },
};

function Check({
  verdict,
  title,
  children,
}: {
  verdict: Verdict;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid gap-x-6 gap-y-2 border-t border-cream/15 py-6 sm:grid-cols-[8rem_1fr]">
      <span
        className={`h-fit w-fit rounded px-2 py-1 text-sm font-bold ${MARK[verdict].className}`}
      >
        {MARK[verdict].label}
      </span>
      <div>
        <h2 className="font-sans text-lg font-bold">{title}</h2>
        <div className="mt-1 max-w-prose space-y-2 text-sm leading-relaxed text-mist">
          {children}
        </div>
      </div>
    </li>
  );
}

const Mono = ({ children }: { children: ReactNode }) => (
  <span className="break-all font-mono text-cream">{children}</span>
);

export function Verify() {
  const { id = "" } = useParams();
  const wallet = useWallet();
  const { contract, keeper, session } = useServices();
  const [chain] = useAsync(id, async () => ({
    kat: await contract.getKat(id),
    config: await contract.getConfig(),
  }));
  const [attestation] = useAsync("attestation", () => keeper.attestation());
  const isOwner = chain.status === "ready" && chain.data.kat?.owner_id === wallet.accountId;
  const [context] = useAsync(isOwner && session ? id : null, () =>
    (session as NonNullable<typeof session>).call((token) => keeper.getContext(token, id)),
  );
  const keeperKey =
    attestation.status === "ready" && typeof attestation.data.keeper_public_key === "string"
      ? attestation.data.keeper_public_key
      : null;
  const keeperId = chain.status === "ready" ? chain.data.config.keeper_id : null;
  const [keyHeld] = useAsync(keeperKey && keeperId ? `${keeperId}/${keeperKey}` : null, () =>
    contract.accountHoldsKey(keeperId as string, keeperKey as string),
  );
  const proof = recallProof(id);
  const signature = proof ? checkSignature(proof) : null;

  if (chain.status === "loading") {
    return (
      <Shell world="burrow">
        <p className="text-mist">Reading the contract…</p>
      </Shell>
    );
  }
  if (chain.status === "error" || !chain.data.kat) {
    return (
      <Shell world="burrow">
        <p className="text-alarm" role="alert">
          {chain.status === "error"
            ? `Can't read the contract. ${describeProblem(chain.error)}`
            : `There is no Nearkat #${id}.`}
        </p>
      </Shell>
    );
  }
  const { kat } = chain.data;
  const matches =
    context.status === "ready" ? contextHash(context.data) === kat.context_hash : null;
  const local = attestation.status === "ready" && attestation.data.mode === "local";

  return (
    <Shell world="burrow">
      <Link to={`/kat/${id}`} className="text-sm text-mist underline-offset-4 hover:underline">
        Back to Nearkat #{id}
      </Link>
      <h1 className="mt-6 text-4xl sm:text-5xl">Verify Nearkat #{id}</h1>
      <p className="mt-4 max-w-prose text-mist">
        What this page can check for itself, in your browser, and what it can't.
      </p>
      <ul className="mt-10">
        <Check
          verdict={kat.context_hash ? "pass" : "unknown"}
          title="Its mind is recorded on-chain"
        >
          {kat.context_hash ? (
            <>
              <p>
                The contract holds a fingerprint of version {kat.context_version} of this kat's
                mind. The keeper can't swap in a different mind without changing it.
              </p>
              <p>
                Fingerprint <Mono>{kat.context_hash}</Mono>
              </p>
            </>
          ) : (
            <p>This kat is still waking up and has no recorded mind yet.</p>
          )}
        </Check>

        <Check
          verdict={matches === null ? "unknown" : matches ? "pass" : "fail"}
          title="What you see is what's recorded"
        >
          {!isOwner && (
            <p>Only the owner can check this, because only the owner can read the mind.</p>
          )}
          {isOwner && context.status === "loading" && (
            <p>Fetching your kat's mind from the keeper…</p>
          )}
          {isOwner && context.status === "error" && <p>{describeProblem(context.error)}</p>}
          {matches === true && (
            <p>
              Your browser recomputed the fingerprint from the personality and memory the keeper
              sent you, and it matches the contract.
            </p>
          )}
          {matches === false && (
            <p>
              The personality and memory the keeper sent you do not produce the fingerprint in the
              contract. Don't trust what this keeper shows you.
            </p>
          )}
        </Check>

        <Check
          verdict={keyHeld.status === "ready" ? (keyHeld.data ? "pass" : "fail") : "unknown"}
          title="The keeper is the one the contract trusts"
        >
          {attestation.status === "error" && <p>{describeProblem(attestation.error)}</p>}
          {keeperKey && keeperId && (
            <p>
              The contract accepts updates from <Mono>{keeperId}</Mono>.{" "}
              {keyHeld.status === "ready" &&
                (keyHeld.data
                  ? "That account holds the key this keeper reports."
                  : "That account does not hold the key this keeper reports.")}
            </p>
          )}
        </Check>

        <Check verdict={local ? "fail" : "unknown"} title="Nobody but the owner can read its mind">
          {local ? (
            <p>
              Not yet. This keeper runs in local mode, so whoever operates it can read every kat's
              mind. That changes when the keeper moves into a sealed enclave.
            </p>
          ) : (
            <p>This page can't check the keeper's enclave report yet.</p>
          )}
        </Check>

        <Check
          verdict={
            !signature || signature.status === "missing" || signature.status === "unsupported"
              ? "unknown"
              : signature.status === "valid" && signature.coversReply
                ? "pass"
                : "fail"
          }
          title="Its latest reply was signed by the model's host"
        >
          {!proof && <p>Talk to this kat in this tab, then come back to check its latest reply.</p>}
          {signature?.status === "missing" && (
            <p>The model's host sent no signature with the latest reply.</p>
          )}
          {signature?.status === "unsupported" && (
            <p>The reply was signed with {signature.algo}, which this page can't check.</p>
          )}
          {signature?.status === "invalid" && (
            <p>The signature on the latest reply is not valid.</p>
          )}
          {signature?.status === "valid" && (
            <>
              <p>
                Signed by <Mono>{signature.signer}</Mono>
                {signature.coversReply
                  ? ", and the signed text names this reply."
                  : ", but the signed text does not name this reply."}
              </p>
              <p>
                This page doesn't yet check that this signer is the model's enclave. Compare it with
                NEAR AI's published attestation for {proof?.model}.
              </p>
            </>
          )}
        </Check>
      </ul>
    </Shell>
  );
}
```

`web/src/App.tsx`:

```tsx
import { BrowserRouter, Route, Routes } from "react-router";
import { Shell } from "./components/Shell.tsx";
import type { AppConfig } from "./lib/config.ts";
import { Home } from "./pages/Home.tsx";
import { Kat } from "./pages/Kat.tsx";
import { Verify } from "./pages/Verify.tsx";
import { ServicesProvider } from "./services.tsx";
import type { WalletBackend } from "./wallet/backend.ts";
import { WalletProvider } from "./wallet/WalletProvider.tsx";

function NotFound() {
  return (
    <Shell world="surface">
      <h1 className="pt-16 text-5xl">Nothing here</h1>
      <p className="mt-4 text-mist">This tunnel doesn't lead anywhere. Head back to the surface.</p>
    </Shell>
  );
}

export function App({ config, backend }: { config: AppConfig; backend: WalletBackend }) {
  return (
    <WalletProvider backend={backend}>
      <ServicesProvider config={config}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/kat/:id" element={<Kat />} />
            <Route path="/kat/:id/verify" element={<Verify />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ServicesProvider>
    </WalletProvider>
  );
}
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { loadConfig } from "./lib/config.ts";
import { connectorBackend, devBackend } from "./wallet/backend.ts";

const root = createRoot(document.getElementById("root") as HTMLElement);
try {
  const config = loadConfig(import.meta.env);
  const backend = config.devWallet ? devBackend(config) : connectorBackend(config);
  root.render(
    <StrictMode>
      <App config={config} backend={backend} />
    </StrictMode>,
  );
} catch (error) {
  // A missing setting is the developer's to fix; say which one.
  root.render(<p style={{ padding: 24 }}>Can't start: {String(error)}</p>);
}
```

`web/.env.example`:

```text
# Copy to .env.local and fill in. Vite reads it on `npm run dev`.
VITE_NEAR_NETWORK=testnet
VITE_CONTRACT_ID=
VITE_KEEPER_URL=http://localhost:8787

# Only for a local sandbox node:
# VITE_NEAR_NETWORK=sandbox
# VITE_NEAR_RPC_URL=http://127.0.0.1:3030

# Test-only: sign with a fixed key instead of a browser wallet. Refused on mainnet.
# VITE_DEV_WALLET_ID=
# VITE_DEV_WALLET_KEY=
```

- [ ] **Step 2: Type-check, lint, test and build**

Run: `npm run typecheck && npm run lint && npm test && VITE_CONTRACT_ID=x.testnet npm run build`
Expected: no type or lint errors, 91 tests pass, and the build prints `built in`.

- [ ] **Step 3: Look at it**

Run: `VITE_CONTRACT_ID=x.testnet npm run dev`, then open http://localhost:3000.
Expected: the headline "Raise a kat. Give it away. It remembers." over a night horizon with a kat standing on its mound. The mint panel reports that it cannot read the contract, because `x.testnet` is not one.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "feat(web): add wallet connection, pages and entry point"
```

### Task 6: End-to-end story in a browser

**Files:**
- Create: `web/README.md`
- Test: `web/playwright.config.ts`
- Test: `web/e2e/global-setup.ts`
- Test: `web/e2e/kat.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`

**Interfaces:**
- Consumes: the finished app, `../keeper`, and the contract wasm at `../contract/target/near/nearkat_nft.wasm`.
- Produces: nothing new.

The harness starts a sandbox node, the keeper (which reports the key its account must hold), deploys the contract, and serves the app twice because each dev wallet is fixed when its server starts. A small HTTP server stands in for the AI model. The story is expected to pass on first run; a failure means the parts disagree, so fix the code, not the test.

- [ ] **Step 1: Build the contract wasm and install the test browser**

Run from the repository root: `(cd contract && cargo near build non-reproducible-wasm) && (cd web && npx playwright install chromium)`
Expected: `contract/target/near/nearkat_nft.wasm` exists and Chromium is downloaded.

- [ ] **Step 2: Write the harness and the story**

`web/playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

// The whole stack (sandbox node, contract, keeper, two web servers) is started
// by e2e/global-setup.ts, because each part needs values from the one before.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } },
});
```

`web/e2e/global-setup.ts`:

```typescript
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKey, Near, type PrivateKey } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

const KEEPER_DIR = resolve(process.env.KEEPER_DIR ?? "../keeper");
const WASM = resolve(process.env.CONTRACT_WASM ?? "../contract/target/near/nearkat_nft.wasm");
const KEEPER_PORT = 8788;
const MODEL_PORT = 8789;
export const ALICE_URL = "http://localhost:3000";
export const BOB_URL = "http://localhost:3001";

const children: ChildProcess[] = [];

function start(command: string, args: string[], cwd: string, env: Record<string, string>) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
  child.stderr?.on("data", (chunk) => process.env.E2E_DEBUG && process.stderr.write(chunk));
  children.push(child);
  return child;
}

async function waitFor(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      return await fetch(url);
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`${url} did not come up`);
}

/** Stands in for NEAR AI Cloud: echoes the user's message, and has no signatures. */
function startFakeModel() {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.url?.startsWith("/chat/completions")) {
        const { messages } = JSON.parse(body) as {
          messages: Array<{ role: string; content: string }>;
        };
        const system = messages[0]?.content ?? "";
        const last = messages.at(-1)?.content ?? "";
        const mood = system.includes("grumpy") ? "Hmph." : "Meow!";
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            id: `chat-${Date.now()}`,
            choices: [{ message: { role: "assistant", content: `${mood} You said: ${last}` } }],
          }),
        );
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  server.listen(MODEL_PORT);
  return server;
}

/** A server left over from an earlier run would answer in place of the one we start. */
async function requireFree(url: string): Promise<void> {
  const taken = await fetch(url).then(
    () => true,
    () => false,
  );
  if (taken) {
    throw new Error(`${url} is already in use. Stop whatever is running there and try again.`);
  }
}

export default async function globalSetup() {
  if (!existsSync(WASM)) {
    throw new Error(`Build the contract first: ${WASM} is missing`);
  }
  for (const url of [ALICE_URL, BOB_URL, `http://127.0.0.1:${KEEPER_PORT}/attestation`]) {
    await requireFree(url);
  }
  const sandbox = await Sandbox.start();
  const root = sandbox.rootAccount.id;
  const rootNear = new Near({ network: sandbox });
  const stamp = Date.now();
  const names = {
    contract: `nearkat-${stamp}.${root}`,
    keeper: `keeper-${stamp}.${root}`,
    alice: `alice-${stamp}.${root}`,
    bob: `bob-${stamp}.${root}`,
  };
  const model = startFakeModel();

  // The keeper derives its own key, so it starts first and tells us which key to register.
  const data = mkdtempSync(join(tmpdir(), "nearkat-e2e-"));
  start("node", ["src/main.ts"], KEEPER_DIR, {
    NEAR_NETWORK: "sandbox",
    NEAR_RPC_URL: sandbox.rpcUrl,
    CONTRACT_ID: names.contract,
    KEEPER_ACCOUNT_ID: names.keeper,
    KEEPER_ROOT_SECRET: "07".repeat(32),
    NEAR_AI_API_KEY: "unused",
    NEAR_AI_BASE_URL: `http://127.0.0.1:${MODEL_PORT}`,
    STORE_DIR: join(data, "contexts"),
    METER_JOURNAL: join(data, "meter.json"),
    PORT: String(KEEPER_PORT),
    WEB_ORIGIN: `${ALICE_URL},${BOB_URL}`,
  });
  const attestation = await (await waitFor(`http://127.0.0.1:${KEEPER_PORT}/attestation`)).json();

  const account = async (id: string, publicKey: string) => {
    await rootNear
      .transaction(root)
      .createAccount(id)
      .transfer(id, "50 NEAR")
      .addKey(publicKey, { type: "fullAccess" })
      .send();
  };
  const owner = generateKey();
  const alice = generateKey();
  const bob = generateKey();
  await account(names.keeper, attestation.keeper_public_key as string);
  await account(names.alice, alice.publicKey.toString());
  await account(names.bob, bob.publicKey.toString());
  await account(names.contract, owner.publicKey.toString());
  await new Near({
    network: sandbox,
    privateKey: owner.secretKey as PrivateKey,
    defaultSignerId: names.contract,
  })
    .transaction(names.contract)
    .deployContract(names.contract, readFileSync(WASM))
    .functionCall(names.contract, "new", {
      admin_id: root,
      keeper_id: names.keeper,
      treasury_id: root,
      mint_price: (10n ** 24n).toString(),
      base_uri: "https://art.example/",
    })
    .send();

  // One web server per person: the dev wallet's key is fixed when the server starts.
  const web = (port: number, id: string, key: string) =>
    // Started with node directly, not through npx, so stopping it stops the server itself.
    start(
      "node",
      ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"],
      process.cwd(),
      {
        VITE_NEAR_NETWORK: "sandbox",
        VITE_NEAR_RPC_URL: sandbox.rpcUrl,
        VITE_CONTRACT_ID: names.contract,
        VITE_KEEPER_URL: `http://127.0.0.1:${KEEPER_PORT}`,
        VITE_DEV_WALLET_ID: id,
        VITE_DEV_WALLET_KEY: key,
      },
    );
  web(3000, names.alice, alice.secretKey);
  web(3001, names.bob, bob.secretKey);
  await waitFor(ALICE_URL);
  await waitFor(BOB_URL);
  process.env.E2E_BOB_ID = names.bob;

  return async () => {
    for (const child of children) {
      child.kill("SIGTERM");
    }
    model.close();
    await sandbox.stop();
  };
}
```

`web/e2e/kat.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { ALICE_URL, BOB_URL } from "./global-setup.ts";

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  }
};

// One story, in order: the second half depends on what the first half did.
test.describe.configure({ mode: "serial" });

test("an owner mints a kat, shapes it, talks to it, and gives it away", async ({ page }) => {
  await page.goto(ALICE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("It remembers.");
  await shot(page, "1-surface");

  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByText("No kats in this wallet yet.")).toBeVisible();
  await page.getByRole("button", { name: "Mint a kat" }).click();

  // Minting lands in the new kat's burrow; the keeper wakes it within a few seconds.
  await expect(page).toHaveURL(/\/kat\/1$/);
  const personality = page.getByLabel("Personality");
  // The keeper needs a few seconds to see the new kat and wake it; the page waits.
  await expect(page.getByRole("status")).toBeVisible();
  await expect(personality).toHaveValue(/newly hatched nearkat/, { timeout: 60_000 });

  await personality.fill("You are grumpy and suspicious of strangers.");
  await page.getByRole("button", { name: "Save personality" }).click();
  await expect(page.getByText("Personality saved.")).toBeVisible();

  await page.getByLabel("Message to Nearkat #1").fill("hello down there");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Hmph. You said: hello down there")).toBeVisible();
  await shot(page, "2-burrow");

  await page.getByRole("link", { name: "Verify this kat" }).click();
  await expect(page.getByRole("heading", { name: "Verify Nearkat #1" })).toBeVisible();
  const row = (title: string) => page.getByRole("listitem").filter({ hasText: title });
  await expect(row("Its mind is recorded on-chain")).toContainText("Checked");
  await expect(row("What you see is what's recorded")).toContainText("matches the contract");
  await expect(row("The keeper is the one the contract trusts")).toContainText("Checked");
  await expect(row("Nobody but the owner can read its mind")).toContainText("local mode");
  await shot(page, "3-verify");

  await page.getByRole("link", { name: "Back to Nearkat #1" }).click();
  await page.getByLabel("Account to give Nearkat #1 to").fill(process.env.E2E_BOB_ID as string);
  await page.getByRole("button", { name: "Give Nearkat #1 away" }).click();
  await page.getByRole("button", { name: /^Yes, give Nearkat #1 to/ }).click();
  await expect(page).toHaveURL(`${ALICE_URL}/`);
  await expect(page.getByText("No kats in this wallet yet.")).toBeVisible();

  // The previous owner can still see that the kat exists, but not its mind.
  await page.goto(`${ALICE_URL}/kat/1`);
  await expect(page.getByText("The connected wallet isn't the owner.")).toBeVisible();
  await expect(page.getByLabel("Personality")).toHaveCount(0);
});

test("the new owner finds the kat with the personality it was given", async ({ page }) => {
  await page.goto(BOB_URL);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("link", { name: /Nearkat #1/ }).click();
  // The keeper trails the chain by a few seconds after a transfer; the page waits for it.
  await expect(page.getByLabel("Personality")).toHaveValue(
    "You are grumpy and suspicious of strangers.",
    { timeout: 60_000 },
  );
  await page.getByLabel("Message to Nearkat #1").fill("who are you?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Hmph. You said: who are you?")).toBeVisible();
});
```

- [ ] **Step 3: Run the story**

Run: `npm run e2e`
Expected: `2 passed`. Set `E2E_DEBUG=1` to see the keeper's log if it fails.

- [ ] **Step 4: Write the README and update the spec**

`web/README.md`:

````markdown
# Nearkat web app

Where owners mint a kat, talk to it, shape its personality, give it away and
check what the keeper tells them. Design:
`../docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`.

It is a static single-page app. It reads the contract directly, sends
transactions through the visitor's wallet, and talks to the keeper for
anything that touches a kat's mind.

## Run

```bash
npm install
cp .env.example .env.local   # then set VITE_CONTRACT_ID and VITE_KEEPER_URL
npm run dev                  # http://localhost:3000
```

The keeper must list this app's origin in its `WEB_ORIGIN`.

## Test

```bash
npm test            # unit and component tests
npm run typecheck
npm run lint
npm run e2e         # the whole story in a real browser
```

`npm run e2e` starts a local NEAR sandbox, deploys the contract, starts the
keeper from `../keeper` with a stand-in for the AI model, and serves this app
twice, once per test wallet. It needs the contract wasm, so build that first
with `cargo near build non-reproducible-wasm` in `../contract`, and a browser:
`npx playwright install chromium`.

## Pages

| Path | What it is |
|---|---|
| `/` | The surface: what a nearkat is, minting, and the kats in your wallet |
| `/kat/:id` | The burrow: talk to a kat, edit its personality, add NEAR, give it away |
| `/kat/:id/verify` | What the browser can check about the kat and its keeper |

## Notes

- Kat portraits are a placeholder badge until the artwork exists; see
  `src/components/KatBadge.tsx`.
- The keeper reads finalized blocks, so it trails the chain by a few seconds.
  After a mint or a transfer the kat page waits for it instead of showing an
  error.
- Browser wallets come through NEAR Connect and work on testnet and mainnet.
  A sandbox has no browser wallets, which is what the dev wallet is for.
````

In `docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`, change the heading `### 4. Web app (`web/`, Next.js)` to `### 4. Web app (`web/`, Vite and React)`.

- [ ] **Step 5: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: 91 tests pass, no type or lint errors, and the build completes.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "test(web): add the end-to-end browser story and README"
```

## Done when

- `npm test` in `web/` reports 91 tests passing.
- `npm run typecheck`, `npm run lint` and `npm run build` are clean.
- `npm run e2e` reports both parts of the story passing.

Not covered here: connecting a real browser wallet, which needs a deployed testnet contract and keeper. That is the first thing to try in plan 4.
