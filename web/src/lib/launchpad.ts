import type { Near } from "near-kit";

/** Where a collection's contexts may be opened. Mirrors the contract. */
export type TeeRequirement = { Phala: { app_id: string } };

/** What a collection contract's `get_collection` returns. */
export interface CollectionView {
  name: string;
  symbol: string;
  base_uri: string;
  prompt: string;
  starter: string;
  max_supply: string | null;
  tee: TeeRequirement | null;
  media_extension: string;
  terms: Terms;
  sealed_prompt: SealedPrompt | null;
  /** Whether a key attested inside the required app is the one the prompt is sealed to. */
  sealed_key_attested: boolean;
  minted: string;
  /** The launchpad that approves this collection's upgrades. */
  factory_id: string | null;
  code_hash: string | null;
  /** Where its context keys come from. Absent on older contracts. */
  key_source?: KeySource | null;
  /** The key epoch new contexts are saved under. It moves on when the keeper changes. */
  key_epoch?: number;
  /** The MPC network's Ed25519 domain token wallets are signed in; null without wallets. */
  wallet_domain_id?: number | null;
}

/** NEAR's MPC network, which derives a collection's context key for its account alone. */
export interface KeySource {
  mpc_contract_id: string;
  domain_id: number;
}

/** Amounts are yoctoNEAR strings. */
export interface Terms {
  royalty_bps: number;
  creator_share_bps: number;
  chat_price: string | null;
  save_price: string | null;
}

export interface SealedPrompt {
  ciphertext: string;
  sealed_to: string;
}

export interface LaunchpadConfig {
  admin_id: string;
  keeper_id: string;
  collection_code_hash: string | null;
  launch_fee: string;
  collection_funding: string;
  /** The key source every new collection gets. */
  key_source?: KeySource | null;
}

export interface CollectionListing {
  account_id: string;
  creator_id: string;
  name: string;
  symbol: string;
  live: boolean;
  code_hash: string;
}

export interface LaunchRequest {
  slug: string;
  name: string;
  symbol: string;
  /** yoctoNEAR */
  mintPrice: bigint;
  prompt: string;
  starter: string;
  maxSupply: number | null;
  /** A Phala app id: only a keeper running as this app may open contexts. */
  phalaAppId: string | null;
  /** Null means the launchpad's keeper. */
  keeperId: string | null;
  /** Where token images live, and their extension. Empty base means none. */
  images: { baseUri: string; extension: string };
  terms: {
    royaltyBps: number;
    creatorShareBps: number;
    chatPrice: bigint | null;
    savePrice: bigint | null;
  };
  /** Secret instructions, already sealed to the keeper in this browser. */
  sealedPrompt: SealedPrompt | null;
}

export const MAX_PROMPT_CHARS = 4000;
export const MAX_STARTER_CHARS = 2000;

/** Why a slug can't be used, or null. Same rules as the contract. */
export function slugProblem(slug: string): string | null {
  if (slug.length === 0 || slug.length > 32) {
    return "Use 1 to 32 characters.";
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return "Use lowercase letters, digits and single hyphens, not at either end.";
  }
  return null;
}

/** A slug made from a collection name: "Latin Tutor!" becomes "latin-tutor". */
export function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}

/** Why a Phala app id is malformed, or null. Same rules as the contract. */
export function appIdProblem(appId: string): string | null {
  return /^[0-9a-f]{1,64}$/.test(appId)
    ? null
    : "A Phala app id is up to 64 lowercase hex characters, as Phala Cloud shows it.";
}

/** The collection prompt for one token, as the keeper builds it. */
export function promptFor(prompt: string, name: string, tokenId: string): string {
  return prompt.replaceAll("{name}", name).replaceAll("{token_id}", tokenId);
}

/** Starting points for the prompt, to show it can be anything. */
export const PROMPT_TEMPLATES = [
  {
    label: "Character",
    prompt:
      "You are {name} #{token_id}, a small dragon who lives in a lighthouse. Stay in character, " +
      "speak in first person and keep replies short.",
    starter: "You have just hatched. You are shy, curious about ships, and afraid of the dark.",
  },
  {
    label: "Tutor",
    prompt:
      "You are {name} #{token_id}, a patient Spanish tutor. Reply mostly in simple Spanish, " +
      "correct one mistake at a time, and keep track of what your student finds hard.",
    starter: "You have not met your student yet. You do not know their level or interests.",
  },
  {
    label: "Game master",
    prompt:
      "You are {name} #{token_id}, the game master of a text adventure set in a drowned city. " +
      "Describe scenes in two or three sentences and always end by asking what the player does.",
    starter: "The adventure has not started. The player stands at the city gate at low tide.",
  },
] as const;

export class Launchpad {
  readonly #near: Near;
  readonly #id: string;

  constructor(near: Near, factoryId: string) {
    this.#near = near;
    this.#id = factoryId;
  }

  get id(): string {
    return this.#id;
  }

  /** The account a slug launches to. */
  accountFor(slug: string): string {
    return `${slug}.${this.#id}`;
  }

  async getConfig(): Promise<LaunchpadConfig> {
    const config = await this.#view<LaunchpadConfig>("get_config", {});
    if (!config) {
      throw new Error("The launchpad returned no configuration");
    }
    return config;
  }

  async collections(): Promise<CollectionListing[]> {
    return (await this.#view<CollectionListing[]>("get_collections", { limit: "100" })) ?? [];
  }

  /** Whether a slug is already launched or launching. */
  async isTaken(slug: string): Promise<boolean> {
    return (
      (await this.#view<unknown>("get_collection", { account_id: this.accountFor(slug) })) != null
    );
  }

  /**
   * Launches a collection owned by the signer. `deposit` must cover the fee
   * and the collection's funding. Resolves once the launch has gone through.
   */
  async launch(request: LaunchRequest, deposit: bigint): Promise<void> {
    await this.#near.call(
      this.#id,
      "launch",
      {
        args: {
          slug: request.slug,
          mint_price: request.mintPrice.toString(),
          collection: {
            name: request.name,
            symbol: request.symbol,
            base_uri: request.images.baseUri,
            media_extension: request.images.extension,
            prompt: request.prompt,
            starter: request.starter,
            max_supply: request.maxSupply === null ? null : String(request.maxSupply),
            tee: request.phalaAppId ? { Phala: { app_id: request.phalaAppId } } : null,
            terms: {
              royalty_bps: request.terms.royaltyBps,
              creator_share_bps: request.terms.creatorShareBps,
              chat_price: request.terms.chatPrice?.toString() ?? null,
              save_price: request.terms.savePrice?.toString() ?? null,
            },
            ...(request.sealedPrompt ? { sealed_prompt: request.sealedPrompt } : {}),
          },
          keeper_id: request.keeperId,
        },
      },
      { gas: "150 Tgas", attachedDeposit: `${deposit} yocto` },
    );
  }

  /** Versions of the collection code collections may move to. */
  async approvedVersions(): Promise<string[]> {
    return (await this.#view<string[]>("get_approved_code_hashes", {})) ?? [];
  }

  #view<T>(method: string, args: object): Promise<T | undefined> {
    return this.#near.view<T>(this.#id, method, args, { finality: "optimistic" });
  }
}

/**
 * What a collection charges per message and per save: its own price, or the
 * keeper's raised to cover the creator's share. Mirrors the keeper's
 * `collectionPrices`, which is what actually charges.
 */
export function pricesFor(
  terms: Terms | undefined,
  keeper: { chat: bigint; save: bigint },
): { chat: bigint; save: bigint } {
  const keep = 10_000n - BigInt(terms?.creator_share_bps ?? 0);
  const price = (set: string | null | undefined, own: bigint) =>
    set ? BigInt(set) : (own * 10_000n + keep - 1n) / keep;
  return {
    chat: price(terms?.chat_price, keeper.chat),
    save: price(terms?.save_price, keeper.save),
  };
}
