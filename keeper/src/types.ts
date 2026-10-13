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
