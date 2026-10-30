import { strFromU8, unzipSync } from "fflate";

/**
 * Chat histories exported from ChatGPT or Claude, read entirely in the
 * owner's browser. Only the owner's own messages are kept, personal details
 * that are easy to spot are blanked out, and the owner sees what will be sent
 * before anything leaves the page.
 */

export type HistorySource = "chatgpt" | "claude";

export interface HistoryMessage {
  text: string;
  /** Milliseconds since 1970, when the export says. */
  at: number | null;
}

export interface History {
  source: HistorySource;
  conversations: number;
  /** The owner's own messages, newest first. */
  messages: HistoryMessage[];
}

export interface Selection {
  /** What will be sent, newest first, already redacted. */
  messages: string[];
  chars: number;
  /** How many emails, phone numbers, links and long numbers were blanked out. */
  redactions: number;
  /** The owner's messages that didn't fit, or were too short to say anything. */
  left: number;
  earliest: number | null;
  latest: number | null;
}

/** What one import may carry; the keeper accepts a little more. */
export const IMPORT_BUDGET = { chars: 100_000, messages: 2000, perMessage: 4000 } as const;

const NOT_AN_EXPORT =
  "This doesn't look like a ChatGPT or Claude export. Use the .zip from Settings → Data controls → Export (ChatGPT) or Settings → Privacy → Export data (Claude), or the conversations.json inside it.";

/** Reads an export: the .zip either service emails you, or the conversations.json inside it. */
export async function readExport(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let text: string;
  if (zipped) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes, {
        filter: (entry) => entry.name.split("/").at(-1) === "conversations.json",
      });
    } catch {
      throw new Error("That zip file couldn't be opened.");
    }
    const name = Object.keys(entries).sort((a, b) => a.length - b.length)[0];
    if (!name) {
      throw new Error(NOT_AN_EXPORT);
    }
    text = strFromU8(entries[name] as Uint8Array);
  } else {
    text = new TextDecoder().decode(bytes);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(NOT_AN_EXPORT);
  }
  return parseConversations(data);
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The owner's messages from a parsed conversations.json, from either service. */
export function parseConversations(data: unknown): History {
  if (!Array.isArray(data) || data.length === 0 || !data.every(isObject)) {
    throw new Error(NOT_AN_EXPORT);
  }
  const conversations = data as Json[];
  const messages: HistoryMessage[] = [];
  let source: HistorySource;
  if (conversations.some((c) => isObject(c.mapping))) {
    source = "chatgpt";
    for (const conversation of conversations) {
      if (!isObject(conversation.mapping)) continue;
      for (const node of Object.values(conversation.mapping)) {
        const message = isObject(node) ? node.message : null;
        if (!isObject(message) || !isObject(message.author) || message.author.role !== "user") {
          continue;
        }
        const content = isObject(message.content) ? message.content : {};
        const parts = Array.isArray(content.parts) ? content.parts : [];
        const text = parts.filter((part) => typeof part === "string").join("\n");
        const at = typeof message.create_time === "number" ? message.create_time * 1000 : null;
        messages.push({ text, at });
      }
    }
  } else if (conversations.some((c) => Array.isArray(c.chat_messages))) {
    source = "claude";
    for (const conversation of conversations) {
      if (!Array.isArray(conversation.chat_messages)) continue;
      for (const message of conversation.chat_messages) {
        if (!isObject(message) || message.sender !== "human") continue;
        const blocks = Array.isArray(message.content) ? message.content : [];
        const fromBlocks = blocks
          .filter(
            (block) => isObject(block) && block.type === "text" && typeof block.text === "string",
          )
          .map((block) => (block as Json).text as string)
          .join("\n");
        const text = typeof message.text === "string" && message.text ? message.text : fromBlocks;
        const parsed =
          typeof message.created_at === "string" ? Date.parse(message.created_at) : NaN;
        messages.push({ text, at: Number.isNaN(parsed) ? null : parsed });
      }
    }
  } else {
    throw new Error(NOT_AN_EXPORT);
  }
  messages.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return { source, conversations: conversations.length, messages };
}

const PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  [/\bhttps?:\/\/\S+/gi, "[link]"],
  // Card numbers in groups of four, and account or ID numbers: long runs of digits.
  [/\b\d{4}(?:[ -]?\d{4}){2,3}\b|\b\d{9,}\b/g, "[number]"],
  [/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, "[phone]"],
];

/** Blanks out emails, links, phone numbers and long numbers. */
export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [pattern, label] of PATTERNS) {
    out = out.replace(pattern, () => {
      count += 1;
      return label;
    });
  }
  return { text: out, count };
}

/** The newest messages that fit one import, redacted, without repeats or one-word lines. */
export function selectForImport(
  history: History,
  budget: { chars: number; messages: number; perMessage: number } = IMPORT_BUDGET,
): Selection {
  const seen = new Set<string>();
  const messages: string[] = [];
  let chars = 0;
  let redactions = 0;
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const message of history.messages) {
    const trimmed = message.text.trim();
    if (trimmed.length < 12 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    const { text, count } = redact(trimmed.slice(0, budget.perMessage));
    if (chars + text.length > budget.chars || messages.length >= budget.messages) break;
    messages.push(text);
    chars += text.length;
    redactions += count;
    if (message.at !== null) {
      latest = latest === null ? message.at : Math.max(latest, message.at);
      earliest = earliest === null ? message.at : Math.min(earliest, message.at);
    }
  }
  return {
    messages,
    chars,
    redactions,
    left: history.messages.length - messages.length,
    earliest,
    latest,
  };
}
