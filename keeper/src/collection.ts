import type { KeySource } from "./ckd.ts";

/**
 * Who a collection's tokens are. The keeper builds every prompt from it, so
 * the same keeper code serves a talking meerkat, a tutor or a game master.
 */
export interface Persona {
  name: string;
  /** Instructions shared by every token. `{name}` and `{token_id}` are filled in. */
  prompt: string;
  /** The context every token starts from. */
  starter: string;
  /** The sealed prompt, opened by this keeper. Never leaves the keeper. */
  secret_prompt?: string;
  /** Whether owners may teach their token from their chat history. */
  history_import?: boolean;
}

/** What a collection publishes on-chain about its tokens. */
export interface CollectionInfo extends Persona {
  /** Where contexts may be opened, if the collection restricts it. */
  tee: TeeRequirement | null;
  /** Prices and the creator's share, as the contract publishes them. */
  terms?: Terms;
  /** Instructions only the TEE app can read, encrypted to its sealing key. */
  sealed_prompt?: { ciphertext: string; sealed_to: string } | null;
  /** NEAR's MPC network, which derives the collection's context keys. */
  key_source: KeySource;
  /** The key epoch new contexts are saved under. */
  key_epoch: number;
  /** The published code each token's wallet account runs; null without wallets. */
  wallet_code_hash?: string | null;
  /** What the tokens are; absent from contracts that predate datasets, which are characters. */
  kind?: CollectionKind;
  /** For a dataset: samples per class, in class order. */
  class_counts?: number[];
  /** Tokens minted so far. */
  minted?: number;
  /** How many tokens the collection will ever have, if limited. */
  max_supply?: number | null;
}

export type CollectionKind = "Character" | { Dataset: { classes: string[] } };

/** Amounts are yoctoNEAR strings. */
export interface Terms {
  royalty_bps: number;
  creator_share_bps: number;
  chat_price: string | null;
  save_price: string | null;
}

/** What this keeper needs per message and per save, at least. */
export interface KeeperPrices {
  chat: bigint;
  save: bigint;
}

/**
 * The prices a collection charges, and why they don't work for this keeper,
 * if they don't. The creator's share comes out of every charge, so what the
 * keeper keeps must still cover its own price. A price the collection leaves
 * unset is the keeper's, raised just enough to cover the creator's share.
 */
export function collectionPrices(
  terms: Terms | undefined,
  keeper: KeeperPrices,
): { chat: bigint; save: bigint; shortfall: string | null } {
  const keep = 10_000n - BigInt(terms?.creator_share_bps ?? 0);
  const price = (set: string | null | undefined, own: bigint) =>
    set ? BigInt(set) : (own * 10_000n + keep - 1n) / keep;
  const chat = price(terms?.chat_price, keeper.chat);
  const save = price(terms?.save_price, keeper.save);
  const covered = (charged: bigint, own: bigint) => (charged * keep) / 10_000n >= own;
  const shortfall =
    covered(chat, keeper.chat) && covered(save, keeper.save)
      ? null
      : "its prices, after the creator's share, are below this keeper's own";
  return { chat, save, shortfall };
}

export type TeeRequirement = { Phala: { app_id: string } };

/** The original collection's persona. Must match the contract's defaults. */
export const DEFAULT_COLLECTION: Persona = {
  name: "Nearkat",
  prompt:
    "You are {name} #{token_id}, a meerkat-like creature who lives in a burrow. " +
    "Stay in character at all times. You are not an AI assistant and never describe " +
    "yourself as a language model. Speak in first person as the kat, and keep replies short.",
  starter:
    "You are a newly hatched nearkat: curious, playful and a little mischievous. " +
    "You do not know much about the world yet, and you are eager to learn from your owner.",
};

/** The collection prompt for one token. */
export function promptFor(collection: Persona, tokenId: string): string {
  return collection.prompt.replaceAll("{name}", collection.name).replaceAll("{token_id}", tokenId);
}

/** The Phala app a collection requires, or null. */
export function requiredPhalaApp(collection: Pick<CollectionInfo, "tee">): string | null {
  return collection.tee?.Phala?.app_id ?? null;
}
