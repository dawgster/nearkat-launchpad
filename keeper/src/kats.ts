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
/** An idle conversation is saved only once it has this many messages (three exchanges). */
const MIN_IDLE_SAVE_MESSAGES = 6;
const SAVE_ATTEMPTS = 3;
/** Unsaved messages kept per kat; the oldest are dropped beyond this. */
const MAX_SESSION_MESSAGES = 40;
const MAX_SUMMARY_CHARS = 2000;

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
  log?: (message: string) => void;
}

/**
 * What the owner sees of their kat's context. It is the whole document,
 * salt included, so the owner can recompute the hash recorded on-chain.
 */
export type ContextView = ContextDoc;

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
  readonly #log: (message: string) => void;
  readonly #sessions = new Map<string, ChatSession>();
  readonly #saved = new Map<string, SavedContext>();
  readonly #locks = new Map<string, Promise<unknown>>();
  #nextToWake = 1;

  constructor(options: KatServiceOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? console.error;
  }

  async getContext(accountId: string, tokenId: string): Promise<ContextView> {
    return this.#locked(tokenId, async () => {
      const doc = await this.#load(tokenId, await this.#owned(accountId, tokenId));
      return doc;
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
      return next;
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
          this.#log(`Inference failed for kat ${tokenId}: ${error.message}`);
          throw new HttpError(503, "inference_unavailable", "The kat cannot think right now");
        }
        throw error;
      }
      // The kat may have been transferred while the model was thinking. The
      // reply was built from the previous owner's context, so it is not released.
      const current = await this.#o.chain.getKat(tokenId);
      if (current?.owner_id !== accountId) {
        this.#sessions.delete(tokenId);
        throw new HttpError(403, "not_owner", `Only the owner of kat ${tokenId} can do this`);
      }
      session.messages.push(user, { role: "assistant", content: result.reply });
      session.lastActive = this.#now();
      this.#o.meter.charge(tokenId, this.#o.prices.chat);

      if (session.messages.length >= CONSOLIDATE_AFTER_MESSAGES) {
        await this.#consolidate(tokenId, owned.kat, doc, session);
      }
      if (session.messages.length > MAX_SESSION_MESSAGES) {
        session.messages.splice(0, session.messages.length - MAX_SESSION_MESSAGES);
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
    for (const tokenId of [...this.#sessions.keys()]) {
      try {
        await this.#locked(tokenId, async () => {
          // Read inside the lock: a chat may have replaced the session meanwhile.
          const session = this.#sessions.get(tokenId);
          if (!session || session.lastActive > cutoff) {
            return;
          }
          const kat = await this.#o.chain.getKat(tokenId);
          if (session.messages.length === 0 || !kat || kat.owner_id !== session.owner) {
            this.#sessions.delete(tokenId);
            return;
          }
          // Too short to be worth a paid save: it waits in the session instead.
          if (session.messages.length < MIN_IDLE_SAVE_MESSAGES) {
            return;
          }
          const owned = this.#withSaved(tokenId, kat);
          if (owned) {
            await this.#consolidate(tokenId, kat, await this.#load(tokenId, owned), session);
          }
        });
      } catch (error) {
        // One unreadable kat must not stop the others from being saved.
        this.#log(`Idle memory save failed for kat ${tokenId}: ${String(error)}`);
      }
    }
  }

  /**
   * Gives every newly minted kat its starter context and returns the ids it
   * woke. Token ids are consecutive integers from 1, so it probes them in
   * order and stops at the first that does not exist yet.
   */
  async wakeNew(): Promise<string[]> {
    const woken: string[] = [];
    let allAwakeSoFar = true;
    for (let id = this.#nextToWake; ; id++) {
      const tokenId = String(id);
      const outcome = await this.#locked(tokenId, () => this.#wake(tokenId));
      if (outcome === "missing") {
        return woken;
      }
      if (outcome === "woken") {
        woken.push(tokenId);
      }
      allAwakeSoFar &&= outcome !== "failed";
      if (allAwakeSoFar) {
        this.#nextToWake = id + 1;
      }
    }
  }

  /** A chain read failure propagates and ends the pass; a failed save is retried next pass. */
  async #wake(tokenId: string): Promise<"woken" | "already" | "missing" | "failed"> {
    const kat = await this.#o.chain.getKat(tokenId);
    if (!kat) {
      return "missing";
    }
    if (this.#withSaved(tokenId, kat)) {
      return "already";
    }
    try {
      await this.#save(newContext(tokenId, 1, STARTER_PERSONALITY, ""));
      return "woken";
    } catch (error) {
      this.#log(`Could not wake kat ${tokenId}: ${String(error)}`);
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
      const memory = summary.reply.slice(0, MAX_SUMMARY_CHARS);
      await this.#save(newContext(tokenId, doc.version + 1, doc.personality, memory));
    } catch (error) {
      this.#log(`Memory save skipped for kat ${tokenId}: ${String(error)}`);
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
    this.#saved.delete(tokenId);
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
