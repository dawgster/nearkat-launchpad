# Nearkat Keeper (Local Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the keeper service that verifies NFT ownership, holds each kat's encrypted context, runs inference and meters usage, running locally against the deployed contract.

**Architecture:** One TypeScript package in `keeper/`, run directly by Node with no build step. Each concern is a small module behind an interface (`Chain`, `ContextStore`, `Inference`, `Keys`), so unit tests use in-memory fakes and the TEE and NOVA variants in plan 4 replace one module each. `KatService` holds the rules; `app.ts` is a thin HTTP layer over it.

**Tech Stack:** Node 24, TypeScript 7, Hono 4, near-kit 0.20, Vitest 5, Biome 2.

**Spec:** `docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md` (sections "2. Keeper", "Data", "Flows", "Error handling").

This is plan 2 of 4. Plan 1 (the NFT contract) is merged. Later: (3) web app, (4) probes plus TEE and NOVA deployment.

All code in this plan was run before the plan was written: every task's end state passes its tests, `tsc --noEmit` and `biome check`, and the final suite (140 tests) includes a sandbox run against the real contract.

## Global Constraints

- Only the current owner, as recorded by the contract, may read or change a kat's context. Ownership is re-checked on every request.
- Session tokens last 15 minutes. Sign-in nonces last 5 minutes and work once.
- Personality prompts and chat messages are 1 to 4,000 characters.
- Context encryption is AES-256-GCM with a per-kat key derived by HKDF-SHA256 from the root secret.
- `context_hash = SHA-256(salt bytes ‖ canonical JSON without the salt field)`.
- A save uploads the blob first; the on-chain hash moves only after the upload succeeds. Failed saves are retried with backoff (3 attempts).
- Memory is folded into the context after every 20 session messages or 10 minutes idle.
- Prices: 0.002 NEAR per chat message, 0.05 NEAR per saved context version; a request is refused (402) if the on-chain balance minus unsettled charges is below its price. Charges are settled with `debit_batch` every 5 minutes.
- Inference failure returns 503 and charges nothing.
- A stored context that does not match the on-chain hash returns 500 `corrupted` and no inference runs.
- No dependency on the Shade Agent framework. Local mode stores contexts on disk (`FileStore`) and reads the root secret from `KEEPER_ROOT_SECRET`.
- Run every command from `keeper/` unless a step says otherwise.

## Review Focus

Each line names a condition the spec implies but does not spell out, and the test that pins it.

1. A chain view lags behind the keeper's own save: the next save still gets the right version and the owner sees the new personality. Test `keeps working when chain views lag behind its own save` (Task 6).
2. A kat is transferred mid-conversation: the new owner's prompt contains none of the previous owner's unsaved messages, and an idle save drops them. Tests `does not show the new owner the previous owner's unsaved conversation`, `drops an idle conversation instead of saving it once the owner changed` (Task 6).
3. Someone signs the challenge with their own key but claims another account: sign-in is refused. Test `signing with your own key does not let you claim someone else's account` (Task 8).
4. The inference provider returns a reply but no signature: the owner still gets the reply, with `signature: null`. Tests `still returns the reply when the signature ...` (Task 3).
5. A kat is minted with the minimum deposit and has zero balance: it still wakes up. Test `wakes a kat with no balance at all` (Task 6).

## File Structure

| File | Responsibility |
|---|---|
| `keeper/src/types.ts` | Shared data shapes: `KatView`, `ContextDoc`, `ChatMessage`. |
| `keeper/src/errors.ts` | `HttpError` and the two domain errors. |
| `keeper/src/keys.ts` | Derives per-kat, session and NEAR keys from the root secret. |
| `keeper/src/crypto.ts` | AES-256-GCM seal and open. |
| `keeper/src/context.ts` | Context hashing, creation, sealing and verified opening. |
| `keeper/src/store.ts` | `ContextStore` interface, `FileStore`, `MemoryStore`. |
| `keeper/src/inference.ts` | `Inference` interface and the NEAR AI Cloud client. |
| `keeper/src/chain.ts` | `Chain` interface and `NearChain` over near-kit. |
| `keeper/src/meter.ts` | Accumulates charges and settles them in batches. |
| `keeper/src/auth.ts` | Sign-in challenge, NEP-413 exchange, session tokens. |
| `keeper/src/kats.ts` | The rules: ownership, balance, chat, memory, waking. |
| `keeper/src/app.ts` | HTTP routes and error mapping. |
| `keeper/src/config.ts` | Environment parsing. |
| `keeper/src/main.ts` | Wiring, background jobs, server start. |
| `keeper/test/fakes.ts` | `FakeChain`, `FakeInference`. |
| `keeper/test/*.test.ts` | One test file per module, plus `integration.test.ts`. |

---
### Task 1: Project setup, key derivation and encryption

**Files:**
- Create: `keeper/package.json`
- Create: `keeper/tsconfig.json`
- Create: `keeper/vitest.config.ts`
- Create: `keeper/biome.json`
- Create: `keeper/.gitignore`
- Create: `keeper/src/types.ts`
- Create: `keeper/src/errors.ts`
- Create: `keeper/src/keys.ts`
- Create: `keeper/src/crypto.ts`
- Test: `keeper/test/keys.test.ts`
- Test: `keeper/test/crypto.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `KatView`, `ContextDoc`, `ChatMessage` (types.ts); `HttpError(status, code, message, extra?)`, `CorruptContextError`, `InferenceError` (errors.ts); `keysFromRootSecret(root: Uint8Array): Keys` with `katKey(tokenId): Buffer`, `sessionKey(): Buffer`, `nearPrivateKey()`, `nearPublicKey()`; `localRootSecret(hex): Buffer`; `seal(key, plaintext): Buffer`, `open(key, blob): Buffer`.

Node 24 runs TypeScript directly by stripping types, so there is no build step. That is why imports end in `.ts` and `tsconfig.json` sets `erasableSyntaxOnly` (no enums or constructor parameter properties).

- [ ] **Step 1: Create the project files**

`keeper/package.json`:

```json
{
  "name": "nearkat-keeper",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "node --env-file-if-exists=.env src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "biome check ."
  },
  "dependencies": {
    "@hono/node-server": "^2.1.5",
    "@scure/base": "^2.4.0",
    "hono": "^4.13.13",
    "near-kit": "^0.20.2"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.15",
    "@types/node": "^24.0.0",
    "typescript": "^7.0.2",
    "vitest": "^5.0.4"
  }
}
```

`keeper/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`keeper/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
```

`keeper/biome.json`:

```json
{
  "files": { "includes": ["src/**", "test/**", "*.ts", "*.json"] },
  "formatter": { "indentStyle": "space", "lineWidth": 100 },
  "linter": { "rules": { "preset": "recommended" } }
}
```

`keeper/.gitignore`:

```text
node_modules/
data/
.env
```

`keeper/src/types.ts`:

```typescript
/** A kat as returned by the contract's `get_kat` view. */
export interface KatView {
  owner_id: string;
  context_hash: string | null;
  context_ref: string | null;
  context_version: string;
  balance: string;
}

/** The plaintext context of one kat. Encrypted as a single blob. */
export interface ContextDoc {
  token_id: string;
  version: number;
  salt: string;
  personality: string;
  memory_summary: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
```

`keeper/src/errors.ts`:

```typescript
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
```

Then run `npm install` in `keeper/`.

- [ ] **Step 2: Write the failing tests**

`keeper/test/keys.test.ts`:

```typescript
import { parseKey } from "near-kit";
import { describe, expect, test } from "vitest";
import { keysFromRootSecret, localRootSecret } from "../src/keys.ts";

const root = Buffer.alloc(32, 7);

describe("keysFromRootSecret", () => {
  test("derives the same keys from the same root secret", () => {
    const a = keysFromRootSecret(root);
    const b = keysFromRootSecret(root);
    expect(a.katKey("1")).toEqual(b.katKey("1"));
    expect(a.sessionKey()).toEqual(b.sessionKey());
    expect(a.nearPrivateKey()).toBe(b.nearPrivateKey());
  });

  test("gives every kat its own 32-byte key", () => {
    const keys = keysFromRootSecret(root);
    expect(keys.katKey("1")).toHaveLength(32);
    expect(keys.katKey("1")).not.toEqual(keys.katKey("2"));
    expect(keys.katKey("1")).not.toEqual(keys.sessionKey());
  });

  test("derives different keys from a different root secret", () => {
    const other = keysFromRootSecret(Buffer.alloc(32, 8));
    expect(other.katKey("1")).not.toEqual(keysFromRootSecret(root).katKey("1"));
  });

  test("produces a NEAR key pair that near-kit accepts", () => {
    const keys = keysFromRootSecret(root);
    const pair = parseKey(keys.nearPrivateKey());
    expect(pair.publicKey.toString()).toBe(keys.nearPublicKey());
  });

  test("rejects a root secret that is not 32 bytes", () => {
    expect(() => keysFromRootSecret(Buffer.alloc(16))).toThrow("32 bytes");
  });
});

describe("localRootSecret", () => {
  test("parses 64 hex characters", () => {
    expect(localRootSecret("07".repeat(32))).toEqual(root);
  });

  test.each([undefined, "", "07".repeat(31), "zz".repeat(32)])("rejects %s", (value) => {
    expect(() => localRootSecret(value)).toThrow("KEEPER_ROOT_SECRET");
  });
});
```

`keeper/test/crypto.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { open, seal } from "../src/crypto.ts";

const key = Buffer.alloc(32, 1);
const text = Buffer.from("a kat's secret");

describe("seal and open", () => {
  test("round-trips plaintext", () => {
    expect(open(key, seal(key, text))).toEqual(text);
  });

  test("produces different ciphertext each time", () => {
    expect(seal(key, text)).not.toEqual(seal(key, text));
  });

  test("does not contain the plaintext", () => {
    expect(seal(key, text).includes(text)).toBe(false);
  });

  test("rejects a modified blob", () => {
    const blob = seal(key, text);
    const index = blob.length - 20;
    blob.writeUInt8(blob.readUInt8(index) ^ 1, index);
    expect(() => open(key, blob)).toThrow();
  });

  test("rejects the wrong key", () => {
    expect(() => open(Buffer.alloc(32, 2), seal(key, text))).toThrow();
  });

  test("rejects a blob too short to hold a nonce and tag", () => {
    expect(() => open(key, Buffer.alloc(10))).toThrow("too short");
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because `../src/keys.ts`, `../src/crypto.ts` do not exist yet; earlier test files still pass.

- [ ] **Step 4: Implement**

`keeper/src/keys.ts`:

```typescript
import { createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { base58 } from "@scure/base";

export interface Keys {
  /** AES-256-GCM key for one kat's context. */
  katKey(tokenId: string): Buffer;
  /** HMAC key for session tokens. */
  sessionKey(): Buffer;
  /** The keeper's NEAR signing key, as `ed25519:<base58>`. */
  nearPrivateKey(): `ed25519:${string}`;
  nearPublicKey(): string;
}

// DER prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows it.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function derive(root: Uint8Array, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), info, 32));
}

export function keysFromRootSecret(root: Uint8Array): Keys {
  if (root.length !== 32) {
    throw new Error("Root secret must be 32 bytes");
  }
  const seed = derive(root, "nearkat/near-key");
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  const publicBytes = Buffer.from(jwk.x as string, "base64url");

  return {
    katKey: (tokenId) => derive(root, `nearkat/kat/${tokenId}`),
    sessionKey: () => derive(root, "nearkat/session"),
    nearPrivateKey: () => `ed25519:${base58.encode(Buffer.concat([seed, publicBytes]))}`,
    nearPublicKey: () => `ed25519:${base58.encode(publicBytes)}`,
  };
}

/** Reads the local-mode root secret: 64 hex characters. */
export function localRootSecret(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("KEEPER_ROOT_SECRET must be 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}
```

`keeper/src/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const NONCE_LEN = 12;
const TAG_LEN = 16;

/** AES-256-GCM. Output layout: nonce (12) | ciphertext | tag (16). */
export function seal(key: Uint8Array, plaintext: Uint8Array): Buffer {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  return Buffer.concat([nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** Throws if the blob was not sealed with this key or was modified. */
export function open(key: Uint8Array, blob: Uint8Array): Buffer {
  if (blob.length < NONCE_LEN + TAG_LEN) {
    throw new Error("Sealed blob is too short");
  }
  const data = Buffer.from(blob);
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, NONCE_LEN));
  decipher.setAuthTag(data.subarray(data.length - TAG_LEN));
  return Buffer.concat([
    decipher.update(data.subarray(NONCE_LEN, data.length - TAG_LEN)),
    decipher.final(),
  ]);
}
```

- [ ] **Step 5: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 6: Commit**

```bash
git add keeper
git commit -m "feat(keeper): add project setup, key derivation and encryption"
```

### Task 2: Context documents and the context store

**Files:**
- Create: `keeper/src/context.ts`
- Create: `keeper/src/store.ts`
- Test: `keeper/test/context.test.ts`
- Test: `keeper/test/store.test.ts`

**Interfaces:**
- Consumes: `Keys`, `seal`, `open`, `ContextDoc`, `CorruptContextError`.
- Produces: `canonicalJson(doc)`, `contextHash(doc): Buffer`, `newContext(tokenId, version, personality, memorySummary): ContextDoc`, `sealContext(keys, doc): Buffer`, `openContext(keys, tokenId, blob, expectedHashB64): ContextDoc`, `STARTER_PERSONALITY`; `ContextStore { put(blob): Promise<string>; get(ref): Promise<Uint8Array> }`, `FileStore(dir)`, `MemoryStore`.

The hash covers the salt bytes followed by the JSON of every other field in a fixed order. A fresh salt per version stops anyone guessing a personality from its public hash.

- [ ] **Step 1: Write the failing tests**

`keeper/test/context.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
  canonicalJson,
  contextHash,
  newContext,
  openContext,
  sealContext,
} from "../src/context.ts";
import { CorruptContextError } from "../src/errors.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import type { ContextDoc } from "../src/types.ts";

const keys = keysFromRootSecret(Buffer.alloc(32, 7));
const doc: ContextDoc = {
  token_id: "1",
  version: 3,
  salt: Buffer.alloc(32, 9).toString("base64"),
  personality: "grumpy",
  memory_summary: "likes fish",
};
const hashOf = (d: ContextDoc) => contextHash(d).toString("base64");

describe("contextHash", () => {
  test("does not depend on the order the fields were written in", () => {
    const reordered: ContextDoc = {
      memory_summary: "likes fish",
      personality: "grumpy",
      salt: doc.salt,
      version: 3,
      token_id: "1",
    };
    expect(hashOf(reordered)).toBe(hashOf(doc));
  });

  test("is 32 bytes", () => {
    expect(contextHash(doc)).toHaveLength(32);
  });

  test.each([
    ["personality", { personality: "cheerful" }],
    ["memory", { memory_summary: "likes birds" }],
    ["version", { version: 4 }],
    ["token id", { token_id: "2" }],
    ["salt", { salt: Buffer.alloc(32, 10).toString("base64") }],
  ])("changes when the %s changes", (_name, change) => {
    expect(hashOf({ ...doc, ...change })).not.toBe(hashOf(doc));
  });

  test("keeps the salt out of the hashed JSON", () => {
    expect(canonicalJson(doc)).not.toContain("salt");
  });
});

describe("newContext", () => {
  test("gives equal contents different hashes", () => {
    const a = newContext("1", 1, "same", "");
    const b = newContext("1", 1, "same", "");
    expect(hashOf(a)).not.toBe(hashOf(b));
  });
});

describe("openContext", () => {
  test("returns the sealed context when the hash matches", () => {
    expect(openContext(keys, "1", sealContext(keys, doc), hashOf(doc))).toEqual(doc);
  });

  test("rejects a context whose hash is not the expected one", () => {
    const blob = sealContext(keys, { ...doc, personality: "swapped" });
    expect(() => openContext(keys, "1", blob, hashOf(doc))).toThrow(CorruptContextError);
  });

  test("rejects another kat's context", () => {
    const other = { ...doc, token_id: "2" };
    expect(() => openContext(keys, "1", sealContext(keys, other), hashOf(other))).toThrow(
      CorruptContextError,
    );
  });

  test("rejects bytes that are not a sealed context", () => {
    expect(() => openContext(keys, "1", Buffer.alloc(64), hashOf(doc))).toThrow(
      CorruptContextError,
    );
  });
});
```

`keeper/test/store.test.ts`:

```typescript
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FileStore, MemoryStore } from "../src/store.ts";

const blob = Buffer.from("ciphertext");

describe("FileStore", () => {
  test("returns what was stored, creating its directory", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "keeper-store-")), "nested");
    const store = new FileStore(dir);
    const ref = await store.put(blob);
    expect(Buffer.from(await store.get(ref))).toEqual(blob);
  });

  test("gives equal blobs the same ref and different blobs different refs", async () => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), "keeper-store-")));
    expect(await store.put(blob)).toBe(await store.put(blob));
    expect(await store.put(blob)).not.toBe(await store.put(Buffer.from("other")));
  });

  test("survives a new instance over the same directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keeper-store-"));
    const ref = await new FileStore(dir).put(blob);
    expect(Buffer.from(await new FileStore(dir).get(ref))).toEqual(blob);
  });

  test.each(["../etc/passwd", "", "abc", "A".repeat(64)])("rejects the ref %j", async (ref) => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), "keeper-store-")));
    await expect(store.get(ref)).rejects.toThrow("Invalid context ref");
  });

  test("fails for a well-formed ref that was never stored", async () => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), "keeper-store-")));
    await expect(store.get("0".repeat(64))).rejects.toThrow();
  });
});

describe("MemoryStore", () => {
  test("returns what was stored", async () => {
    const store = new MemoryStore();
    expect(Buffer.from(await store.get(await store.put(blob)))).toEqual(blob);
  });

  test("fails for an unknown ref", async () => {
    await expect(new MemoryStore().get("nope")).rejects.toThrow("Unknown context ref");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because `../src/context.ts`, `../src/store.ts` do not exist yet; earlier test files still pass.

- [ ] **Step 3: Implement**

`keeper/src/context.ts`:

```typescript
import { createHash, randomBytes } from "node:crypto";
import { open, seal } from "./crypto.ts";
import { CorruptContextError } from "./errors.ts";
import type { Keys } from "./keys.ts";
import type { ContextDoc } from "./types.ts";

export const STARTER_PERSONALITY =
  "You are a newly hatched nearkat: curious, playful and a little mischievous. " +
  "You do not know much about the world yet, and you are eager to learn from your owner.";

/** The JSON that is hashed: every field except the salt, in a fixed order. */
export function canonicalJson(doc: ContextDoc): string {
  return JSON.stringify({
    token_id: doc.token_id,
    version: doc.version,
    personality: doc.personality,
    memory_summary: doc.memory_summary,
  });
}

/** SHA-256 over salt bytes followed by the canonical JSON. */
export function contextHash(doc: ContextDoc): Buffer {
  return createHash("sha256")
    .update(Buffer.from(doc.salt, "base64"))
    .update(canonicalJson(doc), "utf8")
    .digest();
}

/** Builds a context with a fresh salt, so equal contents never share a hash. */
export function newContext(
  tokenId: string,
  version: number,
  personality: string,
  memorySummary: string,
): ContextDoc {
  return {
    token_id: tokenId,
    version,
    salt: randomBytes(32).toString("base64"),
    personality,
    memory_summary: memorySummary,
  };
}

export function sealContext(keys: Keys, doc: ContextDoc): Buffer {
  return seal(keys.katKey(doc.token_id), Buffer.from(JSON.stringify(doc), "utf8"));
}

/** Decrypts a context and checks it against the hash recorded on-chain. */
export function openContext(
  keys: Keys,
  tokenId: string,
  blob: Uint8Array,
  expectedHashB64: string,
): ContextDoc {
  let doc: ContextDoc;
  try {
    doc = JSON.parse(open(keys.katKey(tokenId), blob).toString("utf8")) as ContextDoc;
  } catch {
    throw new CorruptContextError(`Context of kat ${tokenId} cannot be decrypted`);
  }
  const matches =
    doc.token_id === tokenId && contextHash(doc).toString("base64") === expectedHashB64;
  if (!matches) {
    throw new CorruptContextError(`Context of kat ${tokenId} does not match its on-chain hash`);
  }
  return doc;
}
```

`keeper/src/store.ts`:

```typescript
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Holds encrypted context blobs. Never sees plaintext. */
export interface ContextStore {
  /** Stores a blob and returns an opaque reference to it. */
  put(blob: Uint8Array): Promise<string>;
  get(ref: string): Promise<Uint8Array>;
}

function refOf(blob: Uint8Array): string {
  return createHash("sha256").update(blob).digest("hex");
}

/** Local-disk store for development and testnet. */
export class FileStore implements ContextStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async put(blob: Uint8Array): Promise<string> {
    const ref = refOf(blob);
    await mkdir(this.#dir, { recursive: true });
    await writeFile(join(this.#dir, ref), blob);
    return ref;
  }

  async get(ref: string): Promise<Uint8Array> {
    if (!/^[0-9a-f]{64}$/.test(ref)) {
      throw new Error(`Invalid context ref: ${ref}`);
    }
    return readFile(join(this.#dir, ref));
  }
}

export class MemoryStore implements ContextStore {
  readonly #blobs = new Map<string, Uint8Array>();

  async put(blob: Uint8Array): Promise<string> {
    const ref = refOf(blob);
    this.#blobs.set(ref, Uint8Array.from(blob));
    return ref;
  }

  async get(ref: string): Promise<Uint8Array> {
    const blob = this.#blobs.get(ref);
    if (!blob) {
      throw new Error(`Unknown context ref: ${ref}`);
    }
    return blob;
  }
}
```

- [ ] **Step 4: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 5: Commit**

```bash
git add keeper
git commit -m "feat(keeper): add context hashing, sealing and stores"
```

### Task 3: NEAR AI inference client

**Files:**
- Create: `keeper/src/inference.ts`
- Test: `keeper/test/inference.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `InferenceError`.
- Produces: `Inference { chat(messages: ChatMessage[]): Promise<ChatResult> }`, `ChatResult { reply, verification }`, `Verification { chat_id, model, request_hash, response_hash, signature: SignatureInfo | null }`, `NearAiInference({ baseUrl, apiKey, model, fetch?, signatureRetryMs? })`.

NEAR AI signs the exact bytes of the request and response, so both are hashed raw, before parsing. The keeper passes the signature through for the client to verify; it does not verify it itself. A missing signature never fails a chat.

- [ ] **Step 1: Write the failing tests**

`keeper/test/inference.test.ts`:

```typescript
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { InferenceError } from "../src/errors.ts";
import { NearAiInference } from "../src/inference.ts";

const sha256 = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const completion =
  '{"id":"chat-1",  "choices":[{"message":{"role":"assistant","content":"meow"}}]}';
const signature = {
  text: "model:req:res",
  signature: "0xsig",
  signing_address: "0xabc",
  signing_algo: "ecdsa",
  signature_kind: "provider_tee",
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function setup(respond: (url: string, attempt: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const attempts = new Map<string, number>();
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    calls.push({ url, init });
    return respond(url, attempt);
  }) as typeof fetch;
  const inference = new NearAiInference({
    baseUrl: "https://ai.example/v1",
    apiKey: "secret",
    model: "test-model",
    fetch: fakeFetch,
    signatureRetryMs: 0,
  });
  return { inference, calls };
}

const ok = (url: string) =>
  url.includes("/signature/") ? Response.json(signature) : new Response(completion);
const messages = [{ role: "user" as const, content: "hi" }];

describe("NearAiInference", () => {
  test("returns the reply with hashes of the exact bytes sent and received", async () => {
    const { inference, calls } = setup(ok);
    const result = await inference.chat(messages);
    expect(result.reply).toBe("meow");
    expect(result.verification).toEqual({
      chat_id: "chat-1",
      model: "test-model",
      request_hash: sha256(calls[0]?.init?.body as Uint8Array),
      response_hash: sha256(completion),
      signature,
    });
  });

  test("sends the model, messages and the headers signing depends on", async () => {
    const { inference, calls } = setup(ok);
    await inference.chat(messages);
    const { url, init } = calls[0] as Call;
    expect(url).toBe("https://ai.example/v1/chat/completions");
    expect(JSON.parse(Buffer.from(init?.body as Uint8Array).toString())).toEqual({
      model: "test-model",
      messages,
    });
    expect(init?.headers).toMatchObject({
      authorization: "Bearer secret",
      "accept-encoding": "identity",
      "x-no-aliasing": "true",
    });
    expect(calls[1]?.url).toBe("https://ai.example/v1/signature/chat-1?signing_algo=ecdsa");
  });

  test("retries a signature that is not ready yet", async () => {
    const { inference, calls } = setup((url, attempt) =>
      url.includes("/signature/") && attempt < 3 ? new Response("", { status: 404 }) : ok(url),
    );
    expect((await inference.chat(messages)).verification.signature).toEqual(signature);
    expect(calls.filter((call) => call.url.includes("/signature/"))).toHaveLength(3);
  });

  test.each([
    ["never appears", () => new Response("", { status: 404 })],
    ["endpoint errors", () => new Response("", { status: 500 })],
    ["is reported unavailable in a 200", () => Response.json({ error_code: "x", message: "y" })],
    ["is missing fields", () => Response.json({ text: "only" })],
    ["request throws", () => Promise.reject(new Error("offline"))],
  ])("still returns the reply when the signature %s", async (_name, signatureResponse) => {
    const { inference } = setup((url) =>
      url.includes("/signature/") ? signatureResponse() : new Response(completion),
    );
    const result = await inference.chat(messages);
    expect(result.reply).toBe("meow");
    expect(result.verification.signature).toBeNull();
  });

  test.each([
    ["an HTTP error", () => new Response("busy", { status: 503 })],
    ["a body that is not JSON", () => new Response("<html>")],
    ["no choices", () => Response.json({ id: "chat-1", choices: [] })],
    ["an empty reply", () => Response.json({ id: "c", choices: [{ message: { content: "" } }] })],
    ["no id", () => Response.json({ choices: [{ message: { content: "meow" } }] })],
    ["a network failure", () => Promise.reject(new Error("offline"))],
  ])("throws InferenceError on %s", async (_name, response) => {
    const { inference } = setup(() => response());
    await expect(inference.chat(messages)).rejects.toThrow(InferenceError);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because `../src/inference.ts` do not exist yet; earlier test files still pass.

- [ ] **Step 3: Implement**

`keeper/src/inference.ts`:

```typescript
import { createHash } from "node:crypto";
import { InferenceError } from "./errors.ts";
import type { ChatMessage } from "./types.ts";

/** Signature data from the inference provider, passed through for the client to verify. */
export interface SignatureInfo {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind: string;
}

/** What a client needs to check that a reply came from the attested model. */
export interface Verification {
  chat_id: string;
  model: string;
  request_hash: string;
  response_hash: string;
  signature: SignatureInfo | null;
}

export interface ChatResult {
  reply: string;
  verification: Verification;
}

export interface Inference {
  chat(messages: ChatMessage[]): Promise<ChatResult>;
}

export interface NearAiOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  /** Delay between attempts to fetch a signature that is not ready yet. */
  signatureRetryMs?: number;
}

const SIGNATURE_ATTEMPTS = 3;
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** NEAR AI Cloud client (OpenAI-compatible chat completions plus response signatures). */
export class NearAiInference implements Inference {
  readonly #options: NearAiOptions;
  readonly #fetch: typeof fetch;

  constructor(options: NearAiOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const { baseUrl, apiKey, model } = this.#options;
    // The signature covers the exact bytes sent and received, so both are hashed raw.
    const body = Buffer.from(JSON.stringify({ model, messages }), "utf8");
    let response: Response;
    try {
      response = await this.#fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "accept-encoding": "identity",
          "x-no-aliasing": "true",
        },
        body,
      });
    } catch (error) {
      throw new InferenceError(`Inference request failed: ${String(error)}`);
    }
    const raw = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      throw new InferenceError(`Inference returned HTTP ${response.status}`);
    }
    let chatId: unknown;
    let reply: unknown;
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      chatId = parsed.id;
      reply = parsed.choices?.[0]?.message?.content;
    } catch {
      throw new InferenceError("Inference returned a body that is not JSON");
    }
    if (typeof chatId !== "string" || typeof reply !== "string" || reply.length === 0) {
      throw new InferenceError("Inference returned no reply");
    }
    return {
      reply,
      verification: {
        chat_id: chatId,
        model,
        request_hash: sha256Hex(body),
        response_hash: sha256Hex(raw),
        signature: await this.#signature(chatId),
      },
    };
  }

  /** A missing signature never fails the chat; the client sees `null` and can say so. */
  async #signature(chatId: string): Promise<SignatureInfo | null> {
    const { baseUrl, apiKey, signatureRetryMs = 500 } = this.#options;
    const url = `${baseUrl}/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`;
    for (let attempt = 1; attempt <= SIGNATURE_ATTEMPTS; attempt++) {
      try {
        const response = await this.#fetch(url, {
          headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        });
        if (response.ok) {
          const info = (await response.json()) as Partial<SignatureInfo> & { error_code?: unknown };
          const complete =
            info.error_code === undefined &&
            typeof info.text === "string" &&
            typeof info.signature === "string" &&
            typeof info.signing_address === "string" &&
            typeof info.signing_algo === "string" &&
            typeof info.signature_kind === "string";
          return complete ? (info as SignatureInfo) : null;
        }
        if (response.status !== 404) {
          return null;
        }
      } catch {
        return null;
      }
      if (attempt < SIGNATURE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, signatureRetryMs));
      }
    }
    return null;
  }
}
```

- [ ] **Step 4: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 5: Commit**

```bash
git add keeper
git commit -m "feat(keeper): add NEAR AI inference client"
```

### Task 4: Chain interface and metering

**Files:**
- Create: `keeper/src/chain.ts`
- Create: `keeper/test/fakes.ts`
- Create: `keeper/src/meter.ts`
- Test: `keeper/test/meter.test.ts`

**Interfaces:**
- Consumes: `KatView`, `Inference`, `ChatResult`, `InferenceError`.
- Produces: `Chain { getKat(tokenId): Promise<KatView | null>; listTokenIds(fromIndex, limit): Promise<string[]>; setContext(tokenId, hashB64, ref, version): Promise<void>; debitBatch(items: Array<[string, string]>): Promise<void> }`, `NearChain(near, contractId, finality?)`; `Meter(chain)` with `charge(tokenId, amount: bigint)`, `pending(tokenId): bigint`, `flush(): Promise<void>`; test fakes `FakeChain` (`mint`, `transfer`, `kats`, `debits`, `failDebits`, `failSetContext`, `staleViews`), `FakeInference` (`calls`, `down`), constant `NEAR`.

`chain.ts` holds the interface every other module depends on, and the real `NearChain` that Task 8 exercises against a sandbox. `fakes.ts` mirrors the contract rules (version must be previous + 1, debits are all-or-nothing) so unit tests catch the same mistakes the contract would.

- [ ] **Step 1: Create the supporting files**

`keeper/src/chain.ts`:

```typescript
import type { Near } from "near-kit";
import type { KatView } from "./types.ts";

/** Everything the keeper needs from the NFT contract. */
export interface Chain {
  getKat(tokenId: string): Promise<KatView | null>;
  listTokenIds(fromIndex: number, limit: number): Promise<string[]>;
  setContext(tokenId: string, hashB64: string, ref: string, version: number): Promise<void>;
  /** Items are `[token_id, amount in yoctoNEAR]`. Fails as a whole. */
  debitBatch(items: Array<[string, string]>): Promise<void>;
}

export class NearChain implements Chain {
  readonly #near: Near;
  readonly #contractId: string;
  readonly #finality: "final" | "optimistic";

  constructor(near: Near, contractId: string, finality: "final" | "optimistic" = "final") {
    this.#near = near;
    this.#contractId = contractId;
    this.#finality = finality;
  }

  async getKat(tokenId: string): Promise<KatView | null> {
    const kat = await this.#near.view<KatView | null>(
      this.#contractId,
      "get_kat",
      { token_id: tokenId },
      { finality: this.#finality },
    );
    return kat ?? null;
  }

  async listTokenIds(fromIndex: number, limit: number): Promise<string[]> {
    const tokens = await this.#near.view<Array<{ token_id: string }>>(
      this.#contractId,
      "nft_tokens",
      { from_index: String(fromIndex), limit },
      { finality: this.#finality },
    );
    return (tokens ?? []).map((token) => token.token_id);
  }

  async setContext(tokenId: string, hashB64: string, ref: string, version: number): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "set_context",
      { token_id: tokenId, context_hash: hashB64, context_ref: ref, version: String(version) },
      { gas: "30 Tgas" },
    );
  }

  async debitBatch(items: Array<[string, string]>): Promise<void> {
    await this.#near.call(this.#contractId, "debit_batch", { items }, { gas: "100 Tgas" });
  }
}
```

`keeper/test/fakes.ts`:

```typescript
import type { Chain } from "../src/chain.ts";
import { InferenceError } from "../src/errors.ts";
import type { ChatResult, Inference } from "../src/inference.ts";
import type { ChatMessage, KatView } from "../src/types.ts";

export const NEAR = 10n ** 24n;

/** In-memory stand-in for the contract, enforcing the same rules. */
export class FakeChain implements Chain {
  readonly kats = new Map<string, KatView>();
  readonly debits: Array<Array<[string, string]>> = [];
  failDebits = false;
  failSetContext = 0;
  /** When set, views keep returning the context as it was before the last save. */
  staleViews = false;
  #stale = new Map<string, KatView>();

  mint(tokenId: string, owner: string, balance: bigint): void {
    this.kats.set(tokenId, {
      owner_id: owner,
      context_hash: null,
      context_ref: null,
      context_version: "0",
      balance: balance.toString(),
    });
  }

  transfer(tokenId: string, to: string): void {
    this.#kat(tokenId).owner_id = to;
  }

  async getKat(tokenId: string): Promise<KatView | null> {
    const kat = this.kats.get(tokenId);
    if (!kat) {
      return null;
    }
    const stale = this.staleViews ? this.#stale.get(tokenId) : undefined;
    return { ...(stale ?? kat), owner_id: kat.owner_id, balance: kat.balance };
  }

  async listTokenIds(fromIndex: number, limit: number): Promise<string[]> {
    return [...this.kats.keys()].slice(fromIndex, fromIndex + limit);
  }

  async setContext(tokenId: string, hashB64: string, ref: string, version: number): Promise<void> {
    if (this.failSetContext > 0) {
      this.failSetContext -= 1;
      throw new Error("RPC unavailable");
    }
    const kat = this.#kat(tokenId);
    if (version !== Number(kat.context_version) + 1) {
      throw new Error(`Version must be ${Number(kat.context_version) + 1}`);
    }
    this.#stale.set(tokenId, { ...kat });
    kat.context_hash = hashB64;
    kat.context_ref = ref;
    kat.context_version = String(version);
  }

  async debitBatch(items: Array<[string, string]>): Promise<void> {
    if (this.failDebits) {
      throw new Error("RPC unavailable");
    }
    for (const [tokenId, amount] of items) {
      if (BigInt(this.#kat(tokenId).balance) < BigInt(amount)) {
        throw new Error(`Insufficient balance for kat ${tokenId}`);
      }
    }
    for (const [tokenId, amount] of items) {
      const kat = this.#kat(tokenId);
      kat.balance = (BigInt(kat.balance) - BigInt(amount)).toString();
    }
    this.debits.push(items);
  }

  #kat(tokenId: string): KatView {
    const kat = this.kats.get(tokenId);
    if (!kat) {
      throw new Error("Kat not found");
    }
    return kat;
  }
}

/** Replies "reply N" and records every prompt it was given. */
export class FakeInference implements Inference {
  readonly calls: ChatMessage[][] = [];
  down = false;

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    if (this.down) {
      throw new InferenceError("model offline");
    }
    this.calls.push(messages.map((message) => ({ ...message })));
    const n = this.calls.length;
    return {
      reply: `reply ${n}`,
      verification: {
        chat_id: `chat-${n}`,
        model: "fake-model",
        request_hash: "aa",
        response_hash: "bb",
        signature: null,
      },
    };
  }
}
```

- [ ] **Step 2: Write the failing tests**

`keeper/test/meter.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { Meter } from "../src/meter.ts";
import { FakeChain, NEAR } from "./fakes.ts";

function setup() {
  const chain = new FakeChain();
  chain.mint("1", "alice.near", NEAR);
  chain.mint("2", "bob.near", NEAR);
  return { chain, meter: new Meter(chain) };
}

describe("Meter", () => {
  test("adds up charges per kat", () => {
    const { meter } = setup();
    meter.charge("1", 5n);
    meter.charge("1", 7n);
    meter.charge("2", 1n);
    expect(meter.pending("1")).toBe(12n);
    expect(meter.pending("2")).toBe(1n);
    expect(meter.pending("3")).toBe(0n);
  });

  test("settles all pending charges in one batch", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    meter.charge("2", 1n);
    await meter.flush();
    expect(chain.debits).toEqual([
      [
        ["1", "5"],
        ["2", "1"],
      ],
    ]);
    expect(meter.pending("1")).toBe(0n);
    expect(chain.kats.get("1")?.balance).toBe((NEAR - 5n).toString());
  });

  test("makes no chain call when nothing is pending", async () => {
    const { chain, meter } = setup();
    await meter.flush();
    expect(chain.debits).toEqual([]);
  });

  test("keeps charges pending when the chain call fails", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    chain.failDebits = true;
    await expect(meter.flush()).rejects.toThrow("RPC unavailable");
    expect(meter.pending("1")).toBe(5n);
    chain.failDebits = false;
    await meter.flush();
    expect(meter.pending("1")).toBe(0n);
  });

  test("keeps a charge made while a flush is in flight", async () => {
    const { chain, meter } = setup();
    meter.charge("1", 5n);
    const flushing = meter.flush();
    meter.charge("1", 2n);
    await flushing;
    expect(meter.pending("1")).toBe(2n);
    expect(chain.debits).toEqual([[["1", "5"]]]);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because `../src/meter.ts` do not exist yet; earlier test files still pass.

- [ ] **Step 4: Implement**

`keeper/src/meter.ts`:

```typescript
import type { Chain } from "./chain.ts";

/** Accumulates per-kat charges and settles them on-chain in batches. */
export class Meter {
  readonly #chain: Chain;
  readonly #pending = new Map<string, bigint>();

  constructor(chain: Chain) {
    this.#chain = chain;
  }

  charge(tokenId: string, amount: bigint): void {
    this.#pending.set(tokenId, this.pending(tokenId) + amount);
  }

  /** Charges recorded for this kat that are not yet settled on-chain. */
  pending(tokenId: string): bigint {
    return this.#pending.get(tokenId) ?? 0n;
  }

  /**
   * Settles everything pending. If the chain call fails, the charges stay
   * pending for the next flush. Charges made while the call is in flight are kept.
   */
  async flush(): Promise<void> {
    const snapshot = [...this.#pending].filter(([, amount]) => amount > 0n);
    if (snapshot.length === 0) {
      return;
    }
    await this.#chain.debitBatch(snapshot.map(([id, amount]) => [id, amount.toString()]));
    for (const [id, amount] of snapshot) {
      const left = this.pending(id) - amount;
      if (left > 0n) {
        this.#pending.set(id, left);
      } else {
        this.#pending.delete(id);
      }
    }
  }
}
```

- [ ] **Step 5: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 6: Commit**

```bash
git add keeper
git commit -m "feat(keeper): add chain interface and metering"
```

### Task 5: Wallet sign-in and sessions

**Files:**
- Create: `keeper/src/auth.ts`
- Test: `keeper/test/auth.test.ts`

**Interfaces:**
- Consumes: `HttpError`.
- Produces: `Auth({ sessionKey, recipient, verify, now? })` with `challenge(): { nonce, message, recipient }`, `createSession(signed, nonce): Promise<Session>`, `verifySession(token): string | null`; `SIGN_IN_MESSAGE`; type `VerifySignature`.

The verifier is injected. In production it is near-kit's `verifyNep413Signature` with a `Near` client, which also checks that the signing key is a full-access key of the claimed account; Task 8 tests that for real.

- [ ] **Step 1: Write the failing tests**

`keeper/test/auth.test.ts`:

```typescript
import type { SignedMessage } from "near-kit";
import { describe, expect, test, vi } from "vitest";
import { Auth, SIGN_IN_MESSAGE, type VerifySignature } from "../src/auth.ts";

const signed: SignedMessage = {
  accountId: "alice.near",
  publicKey: "ed25519:pk",
  signature: "ed25519:sig",
};

function setup(verify: VerifySignature = async () => true) {
  let now = 1_000_000;
  const auth = new Auth({
    sessionKey: Buffer.alloc(32, 3),
    recipient: "nearkat.xyz",
    verify,
    now: () => now,
  });
  return { auth, advance: (ms: number) => (now += ms) };
}

describe("Auth", () => {
  test("turns a signed challenge into a session for the signing account", async () => {
    const { auth } = setup();
    const { nonce } = auth.challenge();
    const session = await auth.createSession(signed, nonce);
    expect(session.account_id).toBe("alice.near");
    expect(session.expires_at).toBe(1_000_000 + 15 * 60 * 1000);
    expect(auth.verifySession(session.token)).toBe("alice.near");
  });

  test("asks the verifier about the issued nonce, message and recipient", async () => {
    const verify = vi.fn<VerifySignature>(async () => true);
    const { auth } = setup(verify);
    const challenge = auth.challenge();
    expect(challenge).toMatchObject({ message: SIGN_IN_MESSAGE, recipient: "nearkat.xyz" });
    await auth.createSession(signed, challenge.nonce);
    expect(verify).toHaveBeenCalledWith(signed, {
      message: SIGN_IN_MESSAGE,
      recipient: "nearkat.xyz",
      nonce: Buffer.from(challenge.nonce, "base64"),
    });
    expect(Buffer.from(challenge.nonce, "base64")).toHaveLength(32);
  });

  test("rejects a signature the verifier does not accept", async () => {
    const { auth } = setup(async () => false);
    await expect(auth.createSession(signed, auth.challenge().nonce)).rejects.toMatchObject({
      status: 401,
      code: "invalid_signature",
    });
  });

  test("accepts each nonce only once", async () => {
    const { auth } = setup();
    const { nonce } = auth.challenge();
    await auth.createSession(signed, nonce);
    await expect(auth.createSession(signed, nonce)).rejects.toMatchObject({
      status: 401,
      code: "invalid_nonce",
    });
  });

  test("burns a nonce even when its signature was rejected", async () => {
    let accept = false;
    const { auth } = setup(async () => accept);
    const { nonce } = auth.challenge();
    await expect(auth.createSession(signed, nonce)).rejects.toMatchObject({ status: 401 });
    accept = true;
    await expect(auth.createSession(signed, nonce)).rejects.toMatchObject({
      code: "invalid_nonce",
    });
  });

  test("rejects a nonce it never issued", async () => {
    const { auth } = setup();
    await expect(auth.createSession(signed, "bm9wZQ==")).rejects.toMatchObject({
      code: "invalid_nonce",
    });
  });

  test("rejects a nonce older than five minutes", async () => {
    const { auth, advance } = setup();
    const { nonce } = auth.challenge();
    advance(5 * 60 * 1000);
    await expect(auth.createSession(signed, nonce)).rejects.toMatchObject({
      code: "invalid_nonce",
    });
  });

  test("expires a session after fifteen minutes", async () => {
    const { auth, advance } = setup();
    const session = await auth.createSession(signed, auth.challenge().nonce);
    advance(15 * 60 * 1000 - 1);
    expect(auth.verifySession(session.token)).toBe("alice.near");
    advance(1);
    expect(auth.verifySession(session.token)).toBeNull();
  });

  test("rejects a token whose payload was changed", async () => {
    const { auth } = setup();
    const { token } = await auth.createSession(signed, auth.challenge().nonce);
    const forged = Buffer.from(
      JSON.stringify({ a: "mallory.near", e: 9_999_999_999_999 }),
    ).toString("base64url");
    expect(auth.verifySession(`${forged}.${token.split(".")[1]}`)).toBeNull();
  });

  test("rejects a token signed with another key", async () => {
    const { auth } = setup();
    const other = new Auth({
      sessionKey: Buffer.alloc(32, 4),
      recipient: "nearkat.xyz",
      verify: async () => true,
      now: () => 1_000_000,
    });
    const { token } = await other.createSession(signed, other.challenge().nonce);
    expect(auth.verifySession(token)).toBeNull();
  });

  test.each(["", "abc", "a.b.c", "."])("rejects the malformed token %j", (token) => {
    expect(setup().auth.verifySession(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because `../src/auth.ts` do not exist yet; earlier test files still pass.

- [ ] **Step 3: Implement**

`keeper/src/auth.ts`:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";
import { generateNonce, type SignedMessage } from "near-kit";
import { HttpError } from "./errors.ts";

export const SIGN_IN_MESSAGE = "Sign in to Nearkat";
const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 15 * 60 * 1000;

export interface SignInParams {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}

/** Checks a NEP-413 signature and that its key is a full-access key of the account. */
export type VerifySignature = (signed: SignedMessage, params: SignInParams) => Promise<boolean>;

export interface AuthOptions {
  sessionKey: Uint8Array;
  recipient: string;
  verify: VerifySignature;
  now?: () => number;
}

export interface Session {
  token: string;
  account_id: string;
  expires_at: number;
}

export class Auth {
  readonly #sessionKey: Uint8Array;
  readonly #recipient: string;
  readonly #verify: VerifySignature;
  readonly #now: () => number;
  readonly #nonces = new Map<string, number>();

  constructor(options: AuthOptions) {
    this.#sessionKey = options.sessionKey;
    this.#recipient = options.recipient;
    this.#verify = options.verify;
    this.#now = options.now ?? Date.now;
  }

  /** Issues a one-time nonce for the wallet to sign. */
  challenge(): { nonce: string; message: string; recipient: string } {
    const now = this.#now();
    for (const [nonce, expiry] of this.#nonces) {
      if (expiry <= now) {
        this.#nonces.delete(nonce);
      }
    }
    const nonce = Buffer.from(generateNonce()).toString("base64");
    this.#nonces.set(nonce, now + NONCE_TTL_MS);
    return { nonce, message: SIGN_IN_MESSAGE, recipient: this.#recipient };
  }

  /** Exchanges a signed challenge for a session token. Each nonce works once. */
  async createSession(signed: SignedMessage, nonce: string): Promise<Session> {
    const expiry = this.#nonces.get(nonce);
    this.#nonces.delete(nonce);
    if (expiry === undefined || expiry <= this.#now()) {
      throw new HttpError(401, "invalid_nonce", "Unknown or expired sign-in nonce");
    }
    const valid = await this.#verify(signed, {
      message: SIGN_IN_MESSAGE,
      recipient: this.#recipient,
      nonce: Buffer.from(nonce, "base64"),
    });
    if (!valid) {
      throw new HttpError(401, "invalid_signature", "Sign-in signature is not valid");
    }
    const expiresAt = this.#now() + SESSION_TTL_MS;
    const payload = Buffer.from(JSON.stringify({ a: signed.accountId, e: expiresAt })).toString(
      "base64url",
    );
    return {
      token: `${payload}.${this.#mac(payload)}`,
      account_id: signed.accountId,
      expires_at: expiresAt,
    };
  }

  /** Returns the account a token belongs to, or null if it is invalid or expired. */
  verifySession(token: string): string | null {
    const [payload, mac, ...rest] = token.split(".");
    if (!payload || !mac || rest.length > 0) {
      return null;
    }
    const expected = Buffer.from(this.#mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }
    try {
      const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        a: unknown;
        e: unknown;
      };
      return typeof a === "string" && typeof e === "number" && e > this.#now() ? a : null;
    } catch {
      return null;
    }
  }

  #mac(payload: string): string {
    return createHmac("sha256", this.#sessionKey).update(payload).digest("base64url");
  }
}
```

- [ ] **Step 4: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 5: Commit**

```bash
git add keeper
git commit -m "feat(keeper): add NEP-413 sign-in and session tokens"
```

### Task 6: Kat service

**Files:**
- Create: `keeper/src/kats.ts`
- Test: `keeper/test/kats.test.ts`

**Interfaces:**
- Consumes: `Chain`, `ContextStore`, `Keys`, `Inference`, `Meter`, context functions, `HttpError`, `InferenceError`, test fakes.
- Produces: `KatService({ chain, store, keys, inference, meter, prices: { chat, save }, now?, retryDelayMs? })` with `getContext(accountId, tokenId)`, `setPersonality(accountId, tokenId, prompt)`, `chat(accountId, tokenId, message)`, `consolidateIdle()`, `wakeNew(): Promise<string[]>`; `MAX_TEXT_CHARS`.

Decisions this module makes that the spec leaves open: waking a kat is free; a memory save that cannot be paid for or whose summary call fails is skipped and the conversation stays in the session; a context this process just saved takes precedence over a chain view that has not caught up; one operation runs at a time per kat.

- [ ] **Step 1: Write the failing tests**

`keeper/test/kats.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { contextHash, openContext, STARTER_PERSONALITY } from "../src/context.ts";
import { CorruptContextError } from "../src/errors.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { MemoryStore } from "../src/store.ts";
import { FakeChain, FakeInference, NEAR } from "./fakes.ts";

const CHAT = 2n * 10n ** 21n;
const SAVE = 5n * 10n ** 22n;
const keys = keysFromRootSecret(Buffer.alloc(32, 7));

async function setup(balance: bigint = NEAR) {
  const chain = new FakeChain();
  const store = new MemoryStore();
  const inference = new FakeInference();
  const meter = new Meter(chain);
  let now = 1_000_000;
  const kats = new KatService({
    chain,
    store,
    keys,
    inference,
    meter,
    prices: { chat: CHAT, save: SAVE },
    now: () => now,
    retryDelayMs: 0,
  });
  chain.mint("1", "alice.near", balance);
  await kats.wakeNew();
  return { chain, store, inference, meter, kats, advance: (ms: number) => (now += ms) };
}

/** Decrypts whatever context the chain currently points at. */
async function onChainContext(chain: FakeChain, store: MemoryStore, tokenId = "1") {
  const kat = chain.kats.get(tokenId);
  if (!kat?.context_ref || !kat.context_hash) {
    throw new Error("kat has no context");
  }
  return openContext(keys, tokenId, await store.get(kat.context_ref), kat.context_hash);
}

describe("wakeNew", () => {
  test("gives a new kat the starter personality as version 1, free of charge", async () => {
    const { chain, store, meter } = await setup();
    const doc = await onChainContext(chain, store);
    expect(doc).toMatchObject({
      token_id: "1",
      version: 1,
      personality: STARTER_PERSONALITY,
      memory_summary: "",
    });
    expect(chain.kats.get("1")?.context_hash).toBe(contextHash(doc).toString("base64"));
    expect(meter.pending("1")).toBe(0n);
  });

  test("wakes a kat with no balance at all", async () => {
    const { chain } = await setup(0n);
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test("leaves awake kats alone and wakes only new ones", async () => {
    const { chain, kats } = await setup();
    chain.mint("2", "bob.near", NEAR);
    expect(await kats.wakeNew()).toEqual(["2"]);
    expect(await kats.wakeNew()).toEqual([]);
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test("wakes a kat on a later pass when the first attempt failed", async () => {
    const { chain, kats } = await setup();
    chain.mint("2", "bob.near", NEAR);
    chain.failSetContext = 3;
    expect(await kats.wakeNew()).toEqual([]);
    expect(await kats.wakeNew()).toEqual(["2"]);
  });

  test("wakes more kats than fit in one page", async () => {
    const { chain, kats } = await setup();
    for (let id = 2; id <= 120; id++) {
      chain.mint(String(id), "bob.near", NEAR);
    }
    expect(await kats.wakeNew()).toHaveLength(119);
    expect(chain.kats.get("120")?.context_version).toBe("1");
  });
});

describe("getContext", () => {
  test("returns the context to the owner", async () => {
    const { kats } = await setup();
    expect(await kats.getContext("alice.near", "1")).toEqual({
      personality: STARTER_PERSONALITY,
      memory_summary: "",
      version: 1,
    });
  });

  test("refuses anyone who is not the owner", async () => {
    const { kats } = await setup();
    await expect(kats.getContext("bob.near", "1")).rejects.toMatchObject({
      status: 403,
      code: "not_owner",
    });
  });

  test("reports an unknown kat as not found", async () => {
    const { kats } = await setup();
    await expect(kats.getContext("alice.near", "99")).rejects.toMatchObject({ status: 404 });
  });

  test("reports a kat without a context as still waking up", async () => {
    const { chain, kats } = await setup();
    chain.mint("2", "alice.near", NEAR);
    await expect(kats.getContext("alice.near", "2")).rejects.toMatchObject({
      status: 409,
      code: "waking_up",
    });
  });

  test("refuses to serve a context that does not match the on-chain hash", async () => {
    const { chain, kats } = await setup();
    (chain.kats.get("1") as { context_hash: string }).context_hash =
      Buffer.alloc(32).toString("base64");
    await expect(kats.getContext("alice.near", "1")).rejects.toThrow(CorruptContextError);
  });
});

describe("setPersonality", () => {
  test("saves the prompt as the next version and charges one save", async () => {
    const { chain, store, meter, kats } = await setup();
    const view = await kats.setPersonality("alice.near", "1", "You are grumpy.");
    expect(view).toEqual({ personality: "You are grumpy.", memory_summary: "", version: 2 });
    expect(await onChainContext(chain, store)).toMatchObject({
      version: 2,
      personality: "You are grumpy.",
    });
    expect(meter.pending("1")).toBe(SAVE);
  });

  test("refuses anyone who is not the owner and changes nothing", async () => {
    const { chain, kats } = await setup();
    await expect(kats.setPersonality("bob.near", "1", "mine now")).rejects.toMatchObject({
      status: 403,
    });
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test.each([
    ["empty", ""],
    ["only whitespace", "   "],
    ["over 4000 characters", "x".repeat(4001)],
    ["not a string", 42 as unknown as string],
  ])("rejects a prompt that is %s", async (_name, prompt) => {
    const { kats } = await setup();
    await expect(kats.setPersonality("alice.near", "1", prompt)).rejects.toMatchObject({
      status: 400,
      code: "invalid_input",
    });
  });

  test("accepts a prompt of exactly 4000 characters", async () => {
    const { kats } = await setup();
    const view = await kats.setPersonality("alice.near", "1", "x".repeat(4000));
    expect(view.version).toBe(2);
  });

  test("refuses when the kat cannot pay for the save", async () => {
    const { chain, kats } = await setup(SAVE - 1n);
    await expect(kats.setPersonality("alice.near", "1", "grumpy")).rejects.toMatchObject({
      status: 402,
      code: "insufficient_balance",
      extra: { balance: (SAVE - 1n).toString(), required: SAVE.toString() },
    });
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test("counts unsettled charges against the balance", async () => {
    const { kats } = await setup(SAVE + SAVE - 1n);
    await kats.setPersonality("alice.near", "1", "first");
    await expect(kats.setPersonality("alice.near", "1", "second")).rejects.toMatchObject({
      status: 402,
    });
  });

  test("gives concurrent saves consecutive versions", async () => {
    const { chain, kats } = await setup();
    const results = await Promise.all([
      kats.setPersonality("alice.near", "1", "a"),
      kats.setPersonality("alice.near", "1", "b"),
      kats.setPersonality("alice.near", "1", "c"),
    ]);
    expect(results.map((view) => view.version)).toEqual([2, 3, 4]);
    expect(chain.kats.get("1")?.context_version).toBe("4");
  });

  test("keeps working when chain views lag behind its own save", async () => {
    const { chain, kats } = await setup();
    chain.staleViews = true;
    await kats.setPersonality("alice.near", "1", "first");
    const view = await kats.setPersonality("alice.near", "1", "second");
    expect(view.version).toBe(3);
    expect((await kats.getContext("alice.near", "1")).personality).toBe("second");
  });

  test("retries a save the chain rejected twice", async () => {
    const { chain, kats } = await setup();
    chain.failSetContext = 2;
    expect((await kats.setPersonality("alice.near", "1", "grumpy")).version).toBe(2);
  });

  test("gives up after three failed attempts and charges nothing", async () => {
    const { chain, meter, kats } = await setup();
    chain.failSetContext = 3;
    await expect(kats.setPersonality("alice.near", "1", "grumpy")).rejects.toThrow(
      "RPC unavailable",
    );
    expect(meter.pending("1")).toBe(0n);
    expect((await kats.getContext("alice.near", "1")).personality).toBe(STARTER_PERSONALITY);
  });
});

describe("chat", () => {
  test("replies, charges one message and reports the remaining balance", async () => {
    const { meter, kats } = await setup();
    const result = await kats.chat("alice.near", "1", "hello");
    expect(result.reply).toBe("reply 1");
    expect(result.verification.chat_id).toBe("chat-1");
    expect(result.balance).toBe((NEAR - CHAT).toString());
    expect(meter.pending("1")).toBe(CHAT);
  });

  test("prompts the model with the personality, memory and earlier messages", async () => {
    const { inference, kats } = await setup();
    await kats.setPersonality("alice.near", "1", "You are grumpy.");
    await kats.chat("alice.near", "1", "hello");
    await kats.chat("alice.near", "1", "how are you?");
    expect(inference.calls[1]).toEqual([
      { role: "system", content: "You are grumpy." },
      { role: "user", content: "hello" },
      { role: "assistant", content: "reply 1" },
      { role: "user", content: "how are you?" },
    ]);
  });

  test("refuses anyone who is not the owner without calling the model", async () => {
    const { inference, kats } = await setup();
    await expect(kats.chat("bob.near", "1", "hello")).rejects.toMatchObject({ status: 403 });
    expect(inference.calls).toHaveLength(0);
  });

  test.each([
    ["empty", ""],
    ["over 4000 characters", "x".repeat(4001)],
    ["missing", undefined as unknown as string],
  ])("rejects a message that is %s", async (_name, message) => {
    const { kats } = await setup();
    await expect(kats.chat("alice.near", "1", message)).rejects.toMatchObject({ status: 400 });
  });

  test("refuses when the kat cannot pay for a message", async () => {
    const { inference, kats } = await setup(CHAT - 1n);
    await expect(kats.chat("alice.near", "1", "hello")).rejects.toMatchObject({
      status: 402,
      code: "insufficient_balance",
    });
    expect(inference.calls).toHaveLength(0);
  });

  test("stops at the message the balance no longer covers", async () => {
    const { kats } = await setup(CHAT * 2n);
    await kats.chat("alice.near", "1", "one");
    expect((await kats.chat("alice.near", "1", "two")).balance).toBe("0");
    await expect(kats.chat("alice.near", "1", "three")).rejects.toMatchObject({ status: 402 });
  });

  test("charges nothing and remembers nothing when the model is down", async () => {
    const { inference, meter, kats } = await setup();
    inference.down = true;
    await expect(kats.chat("alice.near", "1", "hello")).rejects.toMatchObject({
      status: 503,
      code: "inference_unavailable",
    });
    expect(meter.pending("1")).toBe(0n);
    inference.down = false;
    await kats.chat("alice.near", "1", "again");
    expect(inference.calls[0]).toHaveLength(2);
  });
});

describe("memory", () => {
  test("folds the conversation into memory after twenty messages", async () => {
    const { chain, store, inference, meter, kats } = await setup();
    for (let i = 1; i <= 10; i++) {
      await kats.chat("alice.near", "1", `message ${i}`);
    }
    // Ten chat calls plus the summary call.
    expect(inference.calls).toHaveLength(11);
    expect(inference.calls[10]?.[1]?.content).toContain("user: message 1\nassistant: reply 1");
    expect(await onChainContext(chain, store)).toMatchObject({
      version: 2,
      personality: STARTER_PERSONALITY,
      memory_summary: "reply 11",
    });
    expect(meter.pending("1")).toBe(CHAT * 10n + SAVE);

    await kats.chat("alice.near", "1", "do you remember?");
    expect(inference.calls[11]).toEqual([
      { role: "system", content: `${STARTER_PERSONALITY}\n\nWhat you remember:\nreply 11` },
      { role: "user", content: "do you remember?" },
    ]);
  });

  test("keeps the conversation in the session when the save cannot be paid for", async () => {
    const { chain, inference, kats } = await setup(CHAT * 11n);
    for (let i = 1; i <= 10; i++) {
      await kats.chat("alice.near", "1", `message ${i}`);
    }
    expect(chain.kats.get("1")?.context_version).toBe("1");
    await kats.chat("alice.near", "1", "still there?");
    expect(inference.calls[10]).toHaveLength(22);
  });

  test("keeps the conversation when the summary call fails, and still replies", async () => {
    const { chain, inference, kats } = await setup();
    for (let i = 1; i <= 9; i++) {
      await kats.chat("alice.near", "1", `message ${i}`);
    }
    const original = inference.chat.bind(inference);
    inference.chat = async (messages) => {
      const result = await original(messages);
      inference.down = true;
      return result;
    };
    expect((await kats.chat("alice.near", "1", "message 10")).reply).toBe("reply 10");
    expect(chain.kats.get("1")?.context_version).toBe("1");
  });

  test("folds an idle conversation into memory after ten minutes", async () => {
    const { chain, store, kats, advance } = await setup();
    await kats.chat("alice.near", "1", "hello");
    advance(10 * 60 * 1000 - 1);
    await kats.consolidateIdle();
    expect(chain.kats.get("1")?.context_version).toBe("1");
    advance(1);
    await kats.consolidateIdle();
    expect(await onChainContext(chain, store)).toMatchObject({
      version: 2,
      memory_summary: "reply 2",
    });
    await kats.consolidateIdle();
    expect(chain.kats.get("1")?.context_version).toBe("2");
  });
});

describe("transfer", () => {
  test("hands the personality and memory to the new owner and locks out the old one", async () => {
    const { chain, kats } = await setup();
    await kats.setPersonality("alice.near", "1", "You are grumpy.");
    chain.transfer("1", "bob.near");
    expect((await kats.getContext("bob.near", "1")).personality).toBe("You are grumpy.");
    await expect(kats.getContext("alice.near", "1")).rejects.toMatchObject({ status: 403 });
    await expect(kats.chat("alice.near", "1", "hello?")).rejects.toMatchObject({ status: 403 });
  });

  test("does not show the new owner the previous owner's unsaved conversation", async () => {
    const { chain, inference, kats } = await setup();
    await kats.chat("alice.near", "1", "my secret");
    chain.transfer("1", "bob.near");
    await kats.chat("bob.near", "1", "hello");
    expect(JSON.stringify(inference.calls[1])).not.toContain("my secret");
    expect(inference.calls[1]).toHaveLength(2);
  });

  test("drops an idle conversation instead of saving it once the owner changed", async () => {
    const { chain, inference, kats, advance } = await setup();
    await kats.chat("alice.near", "1", "my secret");
    chain.transfer("1", "bob.near");
    advance(10 * 60 * 1000);
    await kats.consolidateIdle();
    expect(chain.kats.get("1")?.context_version).toBe("1");
    expect(inference.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because `../src/kats.ts` do not exist yet; earlier test files still pass.

- [ ] **Step 3: Implement**

`keeper/src/kats.ts`:

```typescript
import type { Chain } from "./chain.ts";
import {
  contextHash,
  newContext,
  openContext,
  STARTER_PERSONALITY,
  sealContext,
} from "./context.ts";
import { HttpError, InferenceError } from "./errors.ts";
import type { ChatResult, Inference, Verification } from "./inference.ts";
import type { Keys } from "./keys.ts";
import type { Meter } from "./meter.ts";
import type { ContextStore } from "./store.ts";
import type { ChatMessage, ContextDoc, KatView } from "./types.ts";

export const MAX_TEXT_CHARS = 4000;
const CONSOLIDATE_AFTER_MESSAGES = 20;
const CONSOLIDATE_AFTER_IDLE_MS = 10 * 60 * 1000;
const SAVE_ATTEMPTS = 3;
const WAKE_PAGE = 50;

const SUMMARY_INSTRUCTIONS =
  "You maintain the long-term memory of an AI character. Rewrite the memory so it includes " +
  "what matters from the new conversation: facts about the owner, shared history, and how the " +
  "character's attitudes changed. Reply with the updated memory only, in at most 300 words.";

export interface Prices {
  /** yoctoNEAR per chat message. */
  chat: bigint;
  /** yoctoNEAR per saved context version. */
  save: bigint;
}

export interface KatServiceOptions {
  chain: Chain;
  store: ContextStore;
  keys: Keys;
  inference: Inference;
  meter: Meter;
  prices: Prices;
  now?: () => number;
  /** Delay before retrying a failed save; multiplied by the attempt number. */
  retryDelayMs?: number;
}

export interface ContextView {
  personality: string;
  memory_summary: string;
  version: number;
}

export interface ChatReply {
  reply: string;
  verification: Verification;
  /** The kat's balance in yoctoNEAR after this message's charges. */
  balance: string;
}

interface ChatSession {
  owner: string;
  messages: ChatMessage[];
  lastActive: number;
}

interface SavedContext {
  version: number;
  hash: string;
  ref: string;
}

/** A kat that is owned by the caller and has a context. */
interface OwnedKat {
  kat: KatView;
  version: number;
  hash: string;
  ref: string;
}

export class KatService {
  readonly #o: KatServiceOptions;
  readonly #now: () => number;
  readonly #sessions = new Map<string, ChatSession>();
  readonly #saved = new Map<string, SavedContext>();
  readonly #locks = new Map<string, Promise<unknown>>();
  #wakeFrom = 0;

  constructor(options: KatServiceOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
  }

  async getContext(accountId: string, tokenId: string): Promise<ContextView> {
    return this.#locked(tokenId, async () => {
      const doc = await this.#load(tokenId, await this.#owned(accountId, tokenId));
      return {
        personality: doc.personality,
        memory_summary: doc.memory_summary,
        version: doc.version,
      };
    });
  }

  async setPersonality(accountId: string, tokenId: string, prompt: string): Promise<ContextView> {
    requireText(prompt, "prompt");
    return this.#locked(tokenId, async () => {
      const owned = await this.#owned(accountId, tokenId);
      this.#requireBalance(tokenId, owned.kat, this.#o.prices.save);
      const doc = await this.#load(tokenId, owned);
      const next = newContext(tokenId, doc.version + 1, prompt, doc.memory_summary);
      await this.#save(next);
      this.#o.meter.charge(tokenId, this.#o.prices.save);
      return { personality: prompt, memory_summary: next.memory_summary, version: next.version };
    });
  }

  async chat(accountId: string, tokenId: string, message: string): Promise<ChatReply> {
    requireText(message, "message");
    return this.#locked(tokenId, async () => {
      const owned = await this.#owned(accountId, tokenId);
      this.#requireBalance(tokenId, owned.kat, this.#o.prices.chat);
      const doc = await this.#load(tokenId, owned);
      const session = this.#session(tokenId, accountId);
      const user: ChatMessage = { role: "user", content: message };

      let result: ChatResult;
      try {
        result = await this.#o.inference.chat([systemMessage(doc), ...session.messages, user]);
      } catch (error) {
        if (error instanceof InferenceError) {
          throw new HttpError(503, "inference_unavailable", "The kat cannot think right now");
        }
        throw error;
      }
      session.messages.push(user, { role: "assistant", content: result.reply });
      session.lastActive = this.#now();
      this.#o.meter.charge(tokenId, this.#o.prices.chat);

      if (session.messages.length >= CONSOLIDATE_AFTER_MESSAGES) {
        await this.#consolidate(tokenId, owned.kat, doc, session);
      }
      return {
        reply: result.reply,
        verification: result.verification,
        balance: this.#available(tokenId, owned.kat).toString(),
      };
    });
  }

  /** Folds sessions that have been idle for 10 minutes into long-term memory. */
  async consolidateIdle(): Promise<void> {
    const cutoff = this.#now() - CONSOLIDATE_AFTER_IDLE_MS;
    for (const [tokenId, session] of this.#sessions) {
      if (session.messages.length === 0 || session.lastActive > cutoff) {
        continue;
      }
      await this.#locked(tokenId, async () => {
        const kat = await this.#o.chain.getKat(tokenId);
        if (!kat || kat.owner_id !== session.owner) {
          this.#sessions.delete(tokenId);
          return;
        }
        const owned = this.#withSaved(tokenId, kat);
        if (owned) {
          await this.#consolidate(tokenId, kat, await this.#load(tokenId, owned), session);
        }
      });
    }
  }

  /** Gives every newly minted kat its starter context. Returns the ids it woke. */
  async wakeNew(): Promise<string[]> {
    const woken: string[] = [];
    let index = this.#wakeFrom;
    let allAwakeSoFar = true;
    for (;;) {
      const ids = await this.#o.chain.listTokenIds(index, WAKE_PAGE);
      for (const tokenId of ids) {
        const awake = await this.#locked(tokenId, () => this.#wake(tokenId));
        if (awake === "woken") {
          woken.push(tokenId);
        }
        allAwakeSoFar &&= awake !== "failed";
        index += 1;
        if (allAwakeSoFar) {
          this.#wakeFrom = index;
        }
      }
      if (ids.length < WAKE_PAGE) {
        return woken;
      }
    }
  }

  async #wake(tokenId: string): Promise<"woken" | "already" | "failed"> {
    try {
      const kat = await this.#o.chain.getKat(tokenId);
      if (!kat || this.#withSaved(tokenId, kat)) {
        return "already";
      }
      await this.#save(newContext(tokenId, 1, STARTER_PERSONALITY, ""));
      return "woken";
    } catch {
      return "failed";
    }
  }

  async #consolidate(
    tokenId: string,
    kat: KatView,
    doc: ContextDoc,
    session: ChatSession,
  ): Promise<void> {
    // Skipped, not failed, when it cannot be paid for or the model is down:
    // the messages stay in the session and are folded in on a later attempt.
    if (this.#available(tokenId, kat) < this.#o.prices.save) {
      return;
    }
    const transcript = session.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");
    try {
      const summary = await this.#o.inference.chat([
        { role: "system", content: SUMMARY_INSTRUCTIONS },
        {
          role: "user",
          content: `Current memory:\n${doc.memory_summary || "(empty)"}\n\nNew conversation:\n${transcript}`,
        },
      ]);
      await this.#save(newContext(tokenId, doc.version + 1, doc.personality, summary.reply));
    } catch {
      return;
    }
    this.#o.meter.charge(tokenId, this.#o.prices.save);
    session.messages = [];
  }

  async #owned(accountId: string, tokenId: string): Promise<OwnedKat> {
    const kat = await this.#o.chain.getKat(tokenId);
    if (!kat) {
      throw new HttpError(404, "not_found", `Kat ${tokenId} does not exist`);
    }
    if (kat.owner_id !== accountId) {
      throw new HttpError(403, "not_owner", `Only the owner of kat ${tokenId} can do this`);
    }
    const owned = this.#withSaved(tokenId, kat);
    if (!owned) {
      throw new HttpError(409, "waking_up", `Kat ${tokenId} is still waking up`);
    }
    return owned;
  }

  /**
   * Resolves which context version is current. A context this process just
   * saved wins over a chain view that has not caught up with it yet.
   */
  #withSaved(tokenId: string, kat: KatView): OwnedKat | null {
    const saved = this.#saved.get(tokenId);
    const chainVersion = Number(kat.context_version);
    if (saved && saved.version > chainVersion) {
      return { kat, ...saved };
    }
    if (chainVersion === 0 || !kat.context_hash || !kat.context_ref) {
      return null;
    }
    return { kat, version: chainVersion, hash: kat.context_hash, ref: kat.context_ref };
  }

  async #load(tokenId: string, owned: OwnedKat): Promise<ContextDoc> {
    return openContext(this.#o.keys, tokenId, await this.#o.store.get(owned.ref), owned.hash);
  }

  /** Uploads first; the on-chain hash only moves once the blob is stored. */
  async #save(doc: ContextDoc): Promise<void> {
    const hash = contextHash(doc).toString("base64");
    const ref = await this.#retry(() => this.#o.store.put(sealContext(this.#o.keys, doc)));
    await this.#retry(() => this.#o.chain.setContext(doc.token_id, hash, ref, doc.version));
    this.#saved.set(doc.token_id, { version: doc.version, hash, ref });
  }

  async #retry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (attempt >= SAVE_ATTEMPTS) {
          throw error;
        }
        const delay = (this.#o.retryDelayMs ?? 500) * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  #session(tokenId: string, owner: string): ChatSession {
    let session = this.#sessions.get(tokenId);
    if (!session || session.owner !== owner) {
      // A new owner never sees the previous owner's unsaved conversation.
      session = { owner, messages: [], lastActive: this.#now() };
      this.#sessions.set(tokenId, session);
    }
    return session;
  }

  #available(tokenId: string, kat: KatView): bigint {
    return BigInt(kat.balance) - this.#o.meter.pending(tokenId);
  }

  #requireBalance(tokenId: string, kat: KatView, cost: bigint): void {
    const available = this.#available(tokenId, kat);
    if (available < cost) {
      throw new HttpError(402, "insufficient_balance", `Kat ${tokenId} needs more NEAR`, {
        balance: (available > 0n ? available : 0n).toString(),
        required: cost.toString(),
      });
    }
  }

  /** Runs one operation at a time per kat, so context versions never race. */
  #locked<T>(tokenId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(tokenId) ?? Promise.resolve();
    const next = previous.then(run, run);
    const settled = next.catch(() => undefined);
    this.#locks.set(tokenId, settled);
    void settled.then(() => {
      if (this.#locks.get(tokenId) === settled) {
        this.#locks.delete(tokenId);
      }
    });
    return next;
  }
}

function systemMessage(doc: ContextDoc): ChatMessage {
  const memory = doc.memory_summary ? `\n\nWhat you remember:\n${doc.memory_summary}` : "";
  return { role: "system", content: doc.personality + memory };
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT_CHARS) {
    throw new HttpError(400, "invalid_input", `${field} must be 1 to ${MAX_TEXT_CHARS} characters`);
  }
}
```

- [ ] **Step 4: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 5: Commit**

```bash
git add keeper
git commit -m "feat(keeper): add kat service"
```

### Task 7: HTTP API, configuration and entry point

**Files:**
- Create: `keeper/src/app.ts`
- Create: `keeper/src/config.ts`
- Create: `keeper/src/main.ts`
- Create: `keeper/.env.example`
- Create: `keeper/README.md`
- Test: `keeper/test/app.test.ts`
- Test: `keeper/test/config.test.ts`

**Interfaces:**
- Consumes: `Auth`, `KatService`, `HttpError`, `CorruptContextError`, `NearChain`, `NearAiInference`, `FileStore`, `Meter`, key functions.
- Produces: `createApp({ auth, kats, attestation, webOrigin }): Hono`; `loadConfig(env): Config`; the `npm run dev` entry point.

`config.ts`, `main.ts`, `.env.example` and `README.md` are written in the same step as `app.ts`. `main.ts` has no unit test; Step 5 smoke-tests it over HTTP.

- [ ] **Step 1: Write the failing tests**

`keeper/test/app.test.ts`:

```typescript
import type { SignedMessage } from "near-kit";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { Auth } from "../src/auth.ts";
import { STARTER_PERSONALITY } from "../src/context.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { MemoryStore } from "../src/store.ts";
import { FakeChain, FakeInference, NEAR } from "./fakes.ts";

const keys = keysFromRootSecret(Buffer.alloc(32, 7));

async function setup() {
  const chain = new FakeChain();
  const inference = new FakeInference();
  const kats = new KatService({
    chain,
    store: new MemoryStore(),
    keys,
    inference,
    meter: new Meter(chain),
    prices: { chat: 2n * 10n ** 21n, save: 5n * 10n ** 22n },
    retryDelayMs: 0,
  });
  // Accepts any signature whose text is "valid".
  const auth = new Auth({
    sessionKey: keys.sessionKey(),
    recipient: "nearkat.xyz",
    verify: async (signed) => signed.signature === "valid",
  });
  const app = createApp({
    auth,
    kats,
    attestation: async () => ({ mode: "local" }),
    webOrigin: "http://localhost:3000",
  });
  chain.mint("1", "alice.near", NEAR);
  await kats.wakeNew();

  const signIn = async (accountId: string) => {
    const { nonce } = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const signed: SignedMessage = { accountId, publicKey: "ed25519:pk", signature: "valid" };
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({ nonce, signed_message: signed }),
    });
    return (await response.json()).token as string;
  };
  const as = (token: string, body?: unknown, method = "POST"): RequestInit => ({
    method,
    headers: { authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, chain, inference, signIn, as };
}

describe("keeper HTTP API", () => {
  test("serves the attestation without a session", async () => {
    const { app } = await setup();
    const response = await app.request("/attestation");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "local" });
  });

  test("lets a signed-in owner read, shape and chat with their kat", async () => {
    const { app, signIn, as } = await setup();
    const token = await signIn("alice.near");

    const context = await app.request("/kats/1/context", as(token, undefined, "GET"));
    expect(await context.json()).toEqual({
      personality: STARTER_PERSONALITY,
      memory_summary: "",
      version: 1,
    });

    const shaped = await app.request("/kats/1/personality", as(token, { prompt: "grumpy" }, "PUT"));
    expect(await shaped.json()).toMatchObject({ personality: "grumpy", version: 2 });

    const chat = await app.request("/kats/1/chat", as(token, { message: "hello" }));
    expect(chat.status).toBe(200);
    expect(await chat.json()).toMatchObject({
      reply: "reply 1",
      verification: { chat_id: "chat-1" },
    });
  });

  test.each([
    ["no token", {}],
    ["a made-up token", { authorization: "Bearer nope" }],
    ["a token without the Bearer scheme", { authorization: "nope" }],
  ])("answers 401 to a kat request with %s", async (_name, headers) => {
    const { app } = await setup();
    const response = await app.request("/kats/1/context", { headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
  });

  test("rejects a sign-in whose signature does not verify", async () => {
    const { app } = await setup();
    const { nonce } = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({
        nonce,
        signed_message: { accountId: "alice.near", publicKey: "ed25519:pk", signature: "forged" },
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_signature" });
  });

  test.each([
    ["no body", undefined],
    ["a body that is not JSON", "{"],
    ["a JSON array", "[]"],
    ["no signed message", JSON.stringify({ nonce: "abc" })],
    ["a signed message with no account", JSON.stringify({ nonce: "abc", signed_message: {} })],
  ])("answers 400 to a sign-in with %s", async (_name, body) => {
    const { app } = await setup();
    const response = await app.request("/auth/session", { method: "POST", body });
    expect(response.status).toBe(400);
  });

  test("answers 403 when a signed-in account does not own the kat", async () => {
    const { app, signIn, as } = await setup();
    const response = await app.request(
      "/kats/1/context",
      as(await signIn("bob.near"), undefined, "GET"),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_owner" });
  });

  test("answers 402 with the balance when the kat cannot pay", async () => {
    const { app, chain, signIn, as } = await setup();
    (chain.kats.get("1") as { balance: string }).balance = "5";
    const response = await app.request(
      "/kats/1/chat",
      as(await signIn("alice.near"), { message: "hello" }),
    );
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: "insufficient_balance",
      balance: "5",
      required: "2000000000000000000000",
    });
  });

  test("answers 503 when the model is down", async () => {
    const { app, inference, signIn, as } = await setup();
    inference.down = true;
    const response = await app.request(
      "/kats/1/chat",
      as(await signIn("alice.near"), { message: "hello" }),
    );
    expect(response.status).toBe(503);
  });

  test("answers 500 'corrupted' when the stored context fails its hash check", async () => {
    const { app, chain, signIn, as } = await setup();
    (chain.kats.get("1") as { context_hash: string }).context_hash =
      Buffer.alloc(32).toString("base64");
    const response = await app.request(
      "/kats/1/chat",
      as(await signIn("alice.near"), { message: "hello" }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "corrupted" });
  });

  test.each([
    ["a missing message", {}],
    ["a message that is a number", { message: 5 }],
  ])("answers 400 to a chat with %s", async (_name, body) => {
    const { app, signIn, as } = await setup();
    const response = await app.request("/kats/1/chat", as(await signIn("alice.near"), body));
    expect(response.status).toBe(400);
  });

  test("allows the web app's origin and no other", async () => {
    const { app } = await setup();
    const allowed = await app.request("/attestation", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const other = await app.request("/attestation", {
      headers: { origin: "https://evil.example" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
```

`keeper/test/config.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.ts";

const base = {
  CONTRACT_ID: "nearkat.testnet",
  KEEPER_ACCOUNT_ID: "keeper.testnet",
  NEAR_AI_API_KEY: "key",
};

describe("loadConfig", () => {
  test("fills in defaults", () => {
    expect(loadConfig(base)).toMatchObject({
      network: "testnet",
      contractId: "nearkat.testnet",
      keeperAccountId: "keeper.testnet",
      nearAiBaseUrl: "https://cloud-api.near.ai/v1",
      port: 8787,
      storeDir: "./data/contexts",
      chatPrice: 2n * 10n ** 21n,
      savePrice: 5n * 10n ** 22n,
    });
  });

  test("reads overrides", () => {
    const config = loadConfig({
      ...base,
      NEAR_NETWORK: "mainnet",
      PORT: "9000",
      CHAT_PRICE_YOCTO: "7",
      WEB_ORIGIN: "https://nearkat.xyz",
    });
    expect(config).toMatchObject({
      network: "mainnet",
      port: 9000,
      chatPrice: 7n,
      webOrigin: "https://nearkat.xyz",
    });
  });

  test.each(["CONTRACT_ID", "KEEPER_ACCOUNT_ID", "NEAR_AI_API_KEY"])("requires %s", (name) => {
    expect(() => loadConfig({ ...base, [name]: "" })).toThrow(name);
  });

  test.each([
    ["NEAR_NETWORK", "sandbox"],
    ["PORT", "0"],
    ["PORT", "http"],
    ["PORT", "70000"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(name);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test`
Expected: the new test files fail to load because `../src/app.ts`, `../src/config.ts` do not exist yet; earlier test files still pass.

- [ ] **Step 3: Implement**

`keeper/src/app.ts`:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SignedMessage } from "near-kit";
import type { Auth } from "./auth.ts";
import { CorruptContextError, HttpError } from "./errors.ts";
import type { KatService } from "./kats.ts";

export interface AppOptions {
  auth: Auth;
  kats: KatService;
  /** Served at GET /attestation. */
  attestation: () => Promise<Record<string, unknown>>;
  /** Origin of the web app, for CORS. */
  webOrigin: string;
}

type Env = { Variables: { accountId: string } };

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new HttpError(400, "invalid_input", "Request body must be a JSON object");
}

export function createApp(options: AppOptions): Hono<Env> {
  const { auth, kats } = options;
  const app = new Hono<Env>();

  app.use(
    "*",
    cors({ origin: options.webOrigin, allowHeaders: ["authorization", "content-type"] }),
  );

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json(
        { error: error.code, message: error.message, ...error.extra },
        error.status as ContentfulStatusCode,
      );
    }
    if (error instanceof CorruptContextError) {
      return c.json({ error: "corrupted", message: error.message }, 500);
    }
    console.error(error);
    return c.json({ error: "internal", message: "Internal error" }, 500);
  });

  app.get("/attestation", async (c) => c.json(await options.attestation()));

  app.post("/auth/challenge", (c) => c.json(auth.challenge()));

  app.post("/auth/session", async (c) => {
    const body = await jsonBody(c.req.raw);
    const signed = body.signed_message as SignedMessage | undefined;
    if (
      typeof body.nonce !== "string" ||
      !signed ||
      typeof signed.accountId !== "string" ||
      typeof signed.publicKey !== "string" ||
      typeof signed.signature !== "string"
    ) {
      throw new HttpError(400, "invalid_input", "nonce and signed_message are required");
    }
    return c.json(await auth.createSession(signed, body.nonce));
  });

  app.use("/kats/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const accountId = header.startsWith("Bearer ") ? auth.verifySession(header.slice(7)) : null;
    if (!accountId) {
      throw new HttpError(401, "unauthorized", "A valid session token is required");
    }
    c.set("accountId", accountId);
    await next();
  });

  app.get("/kats/:id/context", async (c) =>
    c.json(await kats.getContext(c.get("accountId"), c.req.param("id"))),
  );

  app.put("/kats/:id/personality", async (c) => {
    const body = await jsonBody(c.req.raw);
    return c.json(
      await kats.setPersonality(c.get("accountId"), c.req.param("id"), body.prompt as string),
    );
  });

  app.post("/kats/:id/chat", async (c) => {
    const body = await jsonBody(c.req.raw);
    return c.json(await kats.chat(c.get("accountId"), c.req.param("id"), body.message as string));
  });

  return app;
}
```

`keeper/src/config.ts`:

```typescript
export interface Config {
  network: "testnet" | "mainnet";
  contractId: string;
  keeperAccountId: string;
  rootSecretHex: string | undefined;
  nearAiBaseUrl: string;
  nearAiApiKey: string;
  nearAiModel: string;
  storeDir: string;
  port: number;
  authRecipient: string;
  webOrigin: string;
  /** yoctoNEAR */
  chatPrice: bigint;
  /** yoctoNEAR */
  savePrice: bigint;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const network = env.NEAR_NETWORK ?? "testnet";
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("NEAR_NETWORK must be testnet or mainnet");
  }
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a port number");
  }
  return {
    network,
    contractId: required(env, "CONTRACT_ID"),
    keeperAccountId: required(env, "KEEPER_ACCOUNT_ID"),
    rootSecretHex: env.KEEPER_ROOT_SECRET,
    nearAiBaseUrl: env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai/v1",
    nearAiApiKey: required(env, "NEAR_AI_API_KEY"),
    nearAiModel: env.NEAR_AI_MODEL ?? "zai-org/GLM-5.1-FP8",
    storeDir: env.STORE_DIR ?? "./data/contexts",
    port,
    authRecipient: env.AUTH_RECIPIENT ?? "nearkat.xyz",
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
    // 0.002 NEAR and 0.05 NEAR
    chatPrice: BigInt(env.CHAT_PRICE_YOCTO ?? "2000000000000000000000"),
    savePrice: BigInt(env.SAVE_PRICE_YOCTO ?? "50000000000000000000000"),
  };
}
```

`keeper/src/main.ts`:

```typescript
import { serve } from "@hono/node-server";
import { Near, verifyNep413Signature } from "near-kit";
import { createApp } from "./app.ts";
import { Auth } from "./auth.ts";
import { NearChain } from "./chain.ts";
import { loadConfig } from "./config.ts";
import { NearAiInference } from "./inference.ts";
import { KatService } from "./kats.ts";
import { keysFromRootSecret, localRootSecret } from "./keys.ts";
import { Meter } from "./meter.ts";
import { FileStore } from "./store.ts";

const WAKE_EVERY_MS = 5_000;
const CONSOLIDATE_EVERY_MS = 60_000;
const FLUSH_EVERY_MS = 5 * 60_000;

const config = loadConfig(process.env);
const keys = keysFromRootSecret(localRootSecret(config.rootSecretHex));
const near = new Near({
  network: config.network,
  privateKey: keys.nearPrivateKey(),
  defaultSignerId: config.keeperAccountId,
});
const chain = new NearChain(near, config.contractId);
const meter = new Meter(chain);
const kats = new KatService({
  chain,
  store: new FileStore(config.storeDir),
  keys,
  inference: new NearAiInference({
    baseUrl: config.nearAiBaseUrl,
    apiKey: config.nearAiApiKey,
    model: config.nearAiModel,
  }),
  meter,
  prices: { chat: config.chatPrice, save: config.savePrice },
});
const auth = new Auth({
  sessionKey: keys.sessionKey(),
  recipient: config.authRecipient,
  verify: (signed, params) => verifyNep413Signature(signed, params, { near }),
});
const app = createApp({
  auth,
  kats,
  attestation: async () => ({ mode: "local", keeper_public_key: keys.nearPublicKey() }),
  webOrigin: config.webOrigin,
});

/** Runs a background job on an interval, never overlapping itself. */
function every(ms: number, name: string, job: () => Promise<unknown>): void {
  let running = false;
  setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await job();
    } catch (error) {
      console.error(`${name} failed:`, error);
    } finally {
      running = false;
    }
  }, ms);
}

every(WAKE_EVERY_MS, "wake", () => kats.wakeNew());
every(CONSOLIDATE_EVERY_MS, "consolidate", () => kats.consolidateIdle());
every(FLUSH_EVERY_MS, "flush", () => meter.flush());

serve({ fetch: app.fetch, port: config.port });
console.log(`Keeper listening on :${config.port} for ${config.contractId} (${config.network})`);
console.log(`Keeper account ${config.keeperAccountId} must hold key ${keys.nearPublicKey()}`);
```

`keeper/.env.example`:

```text
# Copy to .env and fill in. `npm run dev` loads .env automatically.
NEAR_NETWORK=testnet
CONTRACT_ID=
KEEPER_ACCOUNT_ID=
# 64 hex characters. Generate with: openssl rand -hex 32
# Every kat's encryption key and the keeper's NEAR key derive from this.
# Losing it makes all stored contexts unreadable.
KEEPER_ROOT_SECRET=
NEAR_AI_API_KEY=
# Optional, with their defaults:
# NEAR_AI_MODEL=zai-org/GLM-5.1-FP8
# NEAR_AI_BASE_URL=https://cloud-api.near.ai/v1
# STORE_DIR=./data/contexts
# PORT=8787
# AUTH_RECIPIENT=nearkat.xyz
# WEB_ORIGIN=http://localhost:3000
# CHAT_PRICE_YOCTO=2000000000000000000000
# SAVE_PRICE_YOCTO=50000000000000000000000
```

`keeper/README.md`:

````markdown
# Nearkat keeper

The service that holds each kat's mind. It checks NFT ownership on every
request, decrypts the kat's context, runs inference on NEAR AI Cloud and saves
updated memory. Design: `../docs/superpowers/specs/2026-10-13-nearkat-ai-nft-design.md`.

This is the local mode: the root secret comes from an environment variable
and contexts are stored on disk. Running inside a TEE with NOVA storage is a
later step; until then the operator can read contexts.

## Test

```bash
npm install
npm test           # unit tests, plus a sandbox test against the real contract
npm run typecheck
npm run lint
```

The sandbox test needs the contract wasm and is skipped without it. Build it
first with `cargo near build non-reproducible-wasm` in `../contract`. Its
first run downloads a NEAR sandbox binary.

## Run against testnet

1. Deploy the contract and note its account id.
2. Copy `.env.example` to `.env` and fill it in.
3. Start the keeper once with `npm run dev`. It prints the public key its
   account must hold.
4. Add that key to the keeper account as a full-access key, and make sure the
   contract's `keeper_id` is that account.
5. Restart. New kats are woken within a few seconds of minting.

## API

| Route | Auth | Purpose |
|---|---|---|
| `GET /attestation` | none | Keeper mode and public key |
| `POST /auth/challenge` | none | Nonce, message and recipient to sign (NEP-413) |
| `POST /auth/session` | none | Body `{ nonce, signed_message }`; returns a 15-minute token |
| `GET /kats/:id/context` | owner | Personality, memory summary, version |
| `PUT /kats/:id/personality` | owner | Body `{ prompt }`, up to 4,000 characters |
| `POST /kats/:id/chat` | owner | Body `{ message }`; returns reply, verification data, balance |

Errors are JSON `{ error, message }`: 400 `invalid_input`, 401
`unauthorized`, 402 `insufficient_balance` (with `balance` and `required`),
403 `not_owner`, 404 `not_found`, 409 `waking_up`, 500 `corrupted`, 503
`inference_unavailable`.
````

- [ ] **Step 4: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all test files pass, `tsc` prints nothing, `biome` reports no fixes needed.

- [ ] **Step 5: Smoke-test the server**

Run:

```bash
CONTRACT_ID=x.testnet KEEPER_ACCOUNT_ID=k.testnet NEAR_AI_API_KEY=x PORT=18787 \
  KEEPER_ROOT_SECRET=$(openssl rand -hex 32) timeout 8 node src/main.ts &
curl -s --retry 10 --retry-connrefused --retry-delay 1 localhost:18787/attestation
curl -s -o /dev/null -w "%{http_code}\n" localhost:18787/kats/1/context
```

Expected: the first `curl` prints `{"mode":"local","keeper_public_key":"ed25519:..."}` and the second prints `401`. The server may log failed `wake` jobs, because `x.testnet` is not a real contract; that is expected here.

- [ ] **Step 6: Commit**

```bash
git add keeper
git commit -m "feat(keeper): add HTTP API, configuration and entry point"
```

### Task 8: Sandbox integration test

**Files:**
- Test: `keeper/test/integration.test.ts`

**Interfaces:**
- Consumes: everything above, plus the contract wasm at `contract/target/near/nearkat_nft.wasm`.
- Produces: nothing new.

This test runs finished code against the real contract in a local sandbox node, with real NEP-413 signatures; only inference is faked. It is expected to pass on first run. A failure means the keeper and contract disagree: fix the code, not the test. It is skipped when the wasm is missing, so build the contract first.

- [ ] **Step 1: Build the contract wasm**

Run from the repository root: `cd contract && cargo near build non-reproducible-wasm`
Expected: `contract/target/near/nearkat_nft.wasm` exists.

- [ ] **Step 2: Write the integration test**

`keeper/test/integration.test.ts`:

```typescript
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKey, Near, type PrivateKey, verifyNep413Signature } from "near-kit";
import { Sandbox } from "near-kit/sandbox";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { Auth } from "../src/auth.ts";
import { NearChain } from "../src/chain.ts";
import { STARTER_PERSONALITY } from "../src/context.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { FileStore } from "../src/store.ts";
import type { KatView } from "../src/types.ts";
import { FakeInference } from "./fakes.ts";

const WASM = fileURLToPath(new URL("../../contract/target/near/nearkat_nft.wasm", import.meta.url));
const CHAT = 2n * 10n ** 21n;
const SAVE = 5n * 10n ** 22n;
const RECIPIENT = "nearkat.xyz";

// Runs the real contract in a local sandbox node. Only inference is faked.
describe.skipIf(!existsSync(WASM))("keeper against the contract in a sandbox", () => {
  const keys = keysFromRootSecret(Buffer.alloc(32, 7));
  let sandbox: Sandbox;
  let contractId: string;
  let alice: { id: string; near: Near };
  let bob: { id: string; near: Near };
  let mallory: { id: string; near: Near };
  let chain: NearChain;
  let meter: Meter;
  let kats: KatService;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    sandbox = await Sandbox.start();
    const root = sandbox.rootAccount.id;
    const rootNear = new Near({ network: sandbox });
    const stamp = Date.now();

    const account = async (name: string, publicKey: string) => {
      const id = `${name}-${stamp}.${root}`;
      await rootNear
        .transaction(root)
        .createAccount(id)
        .transfer(id, "50 NEAR")
        .addKey(publicKey, { type: "fullAccess" })
        .send();
      return id;
    };
    const user = async (name: string) => {
      const pair = generateKey();
      const id = await account(name, pair.publicKey.toString());
      const near = new Near({
        network: sandbox,
        privateKey: pair.secretKey as PrivateKey,
        defaultSignerId: id,
      });
      return { id, near };
    };

    const keeperId = await account("keeper", keys.nearPublicKey());
    alice = await user("alice");
    bob = await user("bob");
    mallory = await user("mallory");

    const owner = generateKey();
    contractId = await account("nearkat", owner.publicKey.toString());
    await new Near({
      network: sandbox,
      privateKey: owner.secretKey as PrivateKey,
      defaultSignerId: contractId,
    })
      .transaction(contractId)
      .deployContract(contractId, await readFile(WASM))
      .functionCall(contractId, "new", {
        admin_id: root,
        keeper_id: keeperId,
        treasury_id: root,
        mint_price: (10n ** 24n).toString(),
        base_uri: "https://art.example/",
      })
      .send();

    const keeperNear = new Near({
      network: sandbox,
      privateKey: keys.nearPrivateKey(),
      defaultSignerId: keeperId,
    });
    chain = new NearChain(keeperNear, contractId, "optimistic");
    meter = new Meter(chain);
    kats = new KatService({
      chain,
      store: new FileStore(await mkdtemp(join(tmpdir(), "keeper-it-"))),
      keys,
      inference: new FakeInference(),
      meter,
      prices: { chat: CHAT, save: SAVE },
    });
    const auth = new Auth({
      sessionKey: keys.sessionKey(),
      recipient: RECIPIENT,
      verify: (signed, params) => verifyNep413Signature(signed, params, { near: keeperNear }),
    });
    app = createApp({
      auth,
      kats,
      attestation: async () => ({ mode: "local" }),
      webOrigin: "http://localhost:3000",
    });
  }, 180_000);

  afterAll(async () => {
    await sandbox?.stop();
  });

  /** Signs the keeper's challenge with a wallet key, as the web app will. */
  async function signIn(signer: Near, claimedAccountId?: string): Promise<Response> {
    const challenge = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const signed = await signer.signMessage({
      message: challenge.message,
      recipient: challenge.recipient,
      nonce: Buffer.from(challenge.nonce, "base64"),
    });
    return app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({
        nonce: challenge.nonce,
        signed_message: { ...signed, accountId: claimedAccountId ?? signed.accountId },
      }),
    });
  }

  const call = (token: string, path: string, method: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  test("a kat's shaped personality follows it to a new owner", async () => {
    await alice.near.call(contractId, "mint", {}, { attachedDeposit: "3 NEAR" });
    expect(await kats.wakeNew()).toEqual(["1"]);

    const aliceToken = (await (await signIn(alice.near)).json()).token as string;
    const fresh = await call(aliceToken, "/kats/1/context", "GET");
    expect(await fresh.json()).toMatchObject({ personality: STARTER_PERSONALITY, version: 1 });

    const shaped = await call(aliceToken, "/kats/1/personality", "PUT", {
      prompt: "You are grumpy.",
    });
    expect(await shaped.json()).toMatchObject({ personality: "You are grumpy.", version: 2 });
    const chat = await call(aliceToken, "/kats/1/chat", "POST", { message: "hello" });
    expect(await chat.json()).toMatchObject({ reply: "reply 1" });

    const before = BigInt(((await chain.getKat("1")) as KatView).balance);
    await meter.flush();
    const after = (await chain.getKat("1")) as KatView;
    expect(before - BigInt(after.balance)).toBe(SAVE + CHAT);
    expect(after.context_version).toBe("2");

    await alice.near.call(
      contractId,
      "nft_transfer",
      { receiver_id: bob.id, token_id: "1" },
      { attachedDeposit: "1 yocto" },
    );

    expect((await call(aliceToken, "/kats/1/context", "GET")).status).toBe(403);
    expect((await call(aliceToken, "/kats/1/chat", "POST", { message: "hi" })).status).toBe(403);

    const bobToken = (await (await signIn(bob.near)).json()).token as string;
    const inherited = await call(bobToken, "/kats/1/context", "GET");
    expect(await inherited.json()).toMatchObject({ personality: "You are grumpy.", version: 2 });
  }, 120_000);

  test("signing with your own key does not let you claim someone else's account", async () => {
    const response = await signIn(mallory.near, bob.id);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_signature" });
  }, 60_000);
});
```

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: `Test Files  11 passed (11)` and `Tests  140 passed (140)`, with no skipped tests. The first run downloads a sandbox binary and takes a few minutes.

- [ ] **Step 4: Type-check and lint**

Run: `npm run typecheck && npm run lint`
Expected: no output from `tsc`; `biome` reports no fixes needed.

- [ ] **Step 5: Commit**

```bash
git add keeper
git commit -m "test(keeper): add sandbox integration test"
```

## Done when

- `npm test` in `keeper/` reports 140 tests passing across 11 files, none skipped.
- `npm run typecheck` and `npm run lint` are clean.
- `npm run dev` starts and serves `/attestation`.

Running against testnet needs a deployed contract, a keeper account and a NEAR AI API key; the steps are in `keeper/README.md`. Deployment itself is part of plan 4.
