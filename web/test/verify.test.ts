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
