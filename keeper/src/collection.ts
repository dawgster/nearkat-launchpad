/**
 * What a collection publishes on-chain about its tokens. The keeper builds
 * every prompt from it, so the same keeper code serves a talking meerkat, a
 * tutor or a game master.
 */
export interface CollectionInfo {
  name: string;
  /** Instructions shared by every token. `{name}` and `{token_id}` are filled in. */
  prompt: string;
  /** The context every token starts from. */
  starter: string;
  /** Where contexts may be opened, if the collection restricts it. */
  tee: TeeRequirement | null;
}

export type TeeRequirement = { Phala: { app_id: string } };

/** The original collection. Must match the contract's defaults. */
export const DEFAULT_COLLECTION: CollectionInfo = {
  name: "Nearkat",
  prompt:
    "You are {name} #{token_id}, a meerkat-like creature who lives in a burrow. " +
    "Stay in character at all times. You are not an AI assistant and never describe " +
    "yourself as a language model. Speak in first person as the kat, and keep replies short.",
  starter:
    "You are a newly hatched nearkat: curious, playful and a little mischievous. " +
    "You do not know much about the world yet, and you are eager to learn from your owner.",
  tee: null,
};

/** The collection prompt for one token. */
export function promptFor(collection: CollectionInfo, tokenId: string): string {
  return collection.prompt.replaceAll("{name}", collection.name).replaceAll("{token_id}", tokenId);
}

/** The Phala app a collection requires, or null. */
export function requiredPhalaApp(collection: CollectionInfo): string | null {
  return collection.tee?.Phala?.app_id ?? null;
}
