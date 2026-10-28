/** A kat as returned by the contract's `get_kat` view. */
export interface KatView {
  owner_id: string;
  context_hash: string | null;
  context_ref: string | null;
  context_version: string;
  balance: string;
  /** The key epoch its context is encrypted under; 0 before it has one. */
  key_epoch: number;
}

/** The plaintext context of one kat. Encrypted as a single blob. */
export interface ContextDoc {
  token_id: string;
  version: number;
  salt: string;
  personality: string;
  memory_summary: string;
}

/** A tool call as OpenAI-compatible chat completions carry it. */
export interface ToolCallMessage {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCallMessage[] }
  | { role: "tool"; content: string; tool_call_id: string };
