import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { parseConversations, readExport, redact, selectForImport } from "../src/lib/history.ts";

/** The shape of ChatGPT's conversations.json, trimmed to what matters. */
const chatgpt = [
  {
    title: "Trail running",
    mapping: {
      a: { message: null },
      b: {
        message: {
          author: { role: "system" },
          content: { content_type: "text", parts: ["You are ChatGPT"] },
        },
      },
      c: {
        message: {
          author: { role: "user" },
          create_time: 1_700_000_000,
          content: { content_type: "text", parts: ["plan a 10k trail run for this weekend"] },
        },
      },
      d: {
        message: {
          author: { role: "assistant" },
          create_time: 1_700_000_010,
          content: { content_type: "text", parts: ["Sure! Here's a plan…"] },
        },
      },
    },
  },
  {
    title: "Books",
    mapping: {
      e: {
        message: {
          author: { role: "user" },
          create_time: 1_710_000_000,
          content: {
            content_type: "multimodal_text",
            parts: [{ asset_pointer: "file-1" }, "recommend hard sci-fi like The Expanse"],
          },
        },
      },
    },
  },
];

/** The shape of Claude's conversations.json. */
const claude = [
  {
    uuid: "1",
    name: "Cooking",
    chat_messages: [
      {
        sender: "human",
        text: "what can I cook with lentils and miso?",
        created_at: "2025-03-01T10:00:00Z",
      },
      { sender: "assistant", text: "A miso lentil soup…", created_at: "2025-03-01T10:00:05Z" },
      {
        sender: "human",
        text: "",
        content: [{ type: "text", text: "make it vegan and under 30 minutes please" }],
        created_at: "2025-03-02T10:00:00Z",
      },
    ],
  },
];

describe("reading exports", () => {
  test("keeps only the owner's ChatGPT messages, newest first", () => {
    const history = parseConversations(chatgpt);
    expect(history.source).toBe("chatgpt");
    expect(history.conversations).toBe(2);
    expect(history.messages.map((m) => m.text)).toEqual([
      "recommend hard sci-fi like The Expanse",
      "plan a 10k trail run for this weekend",
    ]);
  });

  test("keeps only the owner's Claude messages, from text or content blocks", () => {
    const history = parseConversations(claude);
    expect(history.source).toBe("claude");
    expect(history.messages.map((m) => m.text)).toEqual([
      "make it vegan and under 30 minutes please",
      "what can I cook with lentils and miso?",
    ]);
  });

  test("opens the zip either service emails, or the bare conversations.json", async () => {
    const zip = zipSync({
      "chat.html": strToU8("<html></html>"),
      "conversations.json": strToU8(JSON.stringify(claude)),
    });
    const fromZip = await readExport({
      name: "export.zip",
      arrayBuffer: async () => zip.buffer as ArrayBuffer,
    });
    expect(fromZip.source).toBe("claude");
    const json = strToU8(JSON.stringify(chatgpt));
    const fromJson = await readExport({
      name: "conversations.json",
      arrayBuffer: async () => json.buffer as ArrayBuffer,
    });
    expect(fromJson.messages).toHaveLength(2);
  });

  test("says so when a file isn't an export", async () => {
    expect(() => parseConversations({ hello: "world" })).toThrow(/doesn't look like/);
    expect(() => parseConversations([{ title: "x" }])).toThrow(/doesn't look like/);
    const zip = zipSync({ "notes.txt": strToU8("hi") });
    await expect(
      readExport({ name: "x.zip", arrayBuffer: async () => zip.buffer as ArrayBuffer }),
    ).rejects.toThrow(/doesn't look like/);
  });
});

describe("what gets sent", () => {
  test("blanks out emails, links, phone numbers and long numbers", () => {
    const { text, count } = redact(
      "mail me at jo.smith+x@example.co.uk or call +44 20 7946 0958, card 4111 1111 1111 1111, see https://x.io/a?b=c",
    );
    expect(text).toBe("mail me at [email] or call [phone], card [number], see [link]");
    expect(count).toBe(4);
  });

  test("takes the newest messages that fit, without repeats or one-liners", () => {
    const history = {
      source: "chatgpt" as const,
      conversations: 1,
      messages: [
        { text: "ok", at: 5 },
        { text: "a newest real question here", at: 4 },
        { text: "a newest real question here", at: 3 },
        { text: "an older real question here", at: 2 },
        { text: "the oldest real question here", at: 1 },
      ],
    };
    const picked = selectForImport(history, { chars: 60, messages: 10, perMessage: 100 });
    expect(picked.messages).toEqual(["a newest real question here", "an older real question here"]);
    expect(picked.left).toBe(3);
    expect(picked).toMatchObject({ earliest: 2, latest: 4 });
  });
});
