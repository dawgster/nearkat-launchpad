import { describe, expect, test } from "vitest";
import type { ContextDoc } from "../src/lib/keeper.ts";
import {
  keyVerdict,
  privacyVerdict,
  recordVerdict,
  signatureVerdict,
} from "../src/lib/verdicts.ts";
import { contextHash } from "../src/lib/verify.ts";

const doc: ContextDoc = {
  token_id: "7",
  version: 3,
  salt: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=",
  personality: "grumpy",
  memory_summary: "",
};
const onChain = (overrides: object = {}) => ({
  context_hash: contextHash(doc),
  context_version: "3",
  ...overrides,
});

describe("recordVerdict", () => {
  test("passes when the owner's copy produces the recorded fingerprint", () => {
    expect(recordVerdict(doc, onChain())).toBe("match");
  });

  test("fails when the same version produces a different fingerprint", () => {
    expect(recordVerdict({ ...doc, personality: "swapped" }, onChain())).toBe("mismatch");
  });

  test("does not accuse the keeper when the contract was read before a newer save", () => {
    expect(recordVerdict({ ...doc, version: 4 }, onChain())).toBe("behind");
    expect(recordVerdict(doc, onChain({ context_version: "4" }))).toBe("behind");
  });

  test.each(["not base64 !!", "", "CQkJ"])(
    "fails, without crashing, on the malformed salt %j",
    (salt) => {
      expect(recordVerdict({ ...doc, salt }, onChain())).toBe("mismatch");
    },
  );

  test("is unknown without the owner's copy or without a recorded fingerprint", () => {
    expect(recordVerdict(null, onChain())).toBe("unknown");
    expect(recordVerdict(doc, onChain({ context_hash: null }))).toBe("unknown");
  });
});

describe("signatureVerdict", () => {
  const valid = { status: "valid", signer: "0xabc", kind: "provider_tee" } as const;

  test("never fully passes, because this page cannot tell whose key signed", () => {
    expect(signatureVerdict({ ...valid, coversReply: true })).toBe("partial");
  });

  test("fails a valid signature that is not about this reply", () => {
    expect(signatureVerdict({ ...valid, coversReply: false })).toBe("fail");
  });

  test("fails an invalid signature", () => {
    expect(signatureVerdict({ status: "invalid" })).toBe("fail");
  });

  test("is unknown when there is nothing it can check", () => {
    expect(signatureVerdict(null)).toBe("unknown");
    expect(signatureVerdict({ status: "missing" })).toBe("unknown");
    expect(signatureVerdict({ status: "unsupported", algo: "rsa" })).toBe("unknown");
  });
});

describe("keyVerdict", () => {
  test("is only partial when the key is on the keeper account, since keys are public", () => {
    expect(keyVerdict(true)).toBe("partial");
  });

  test("fails when the account does not hold the key", () => {
    expect(keyVerdict(false)).toBe("fail");
  });

  test("is unknown when the lookup could not be made", () => {
    expect(keyVerdict(null)).toBe("unknown");
  });
});

describe("privacyVerdict", () => {
  const good = {
    status: "read",
    bindsKey: true,
    logMatchesQuote: true,
    appId: "0a1b",
    claimMatchesLog: true,
  } as const;

  test("fails a local keeper, whose operator can read every mind", () => {
    expect(privacyVerdict("local", null, null)).toBe("fail");
  });

  test("is only partial for a Phala report that holds up, since Intel's signature is checked elsewhere", () => {
    expect(privacyVerdict("phala", good, null)).toBe("partial");
    expect(privacyVerdict("phala", good, "0A1B")).toBe("partial");
  });

  test("fails a keeper running as an app the collection doesn't name", () => {
    expect(privacyVerdict("phala", good, "ffff")).toBe("fail");
  });

  test("fails a report that doesn't hold up", () => {
    expect(privacyVerdict("phala", { ...good, bindsKey: false }, null)).toBe("fail");
    expect(privacyVerdict("phala", { ...good, logMatchesQuote: false }, null)).toBe("fail");
    expect(privacyVerdict("phala", { status: "unreadable", reason: "x" }, null)).toBe("fail");
  });

  test("can't say anything about a mode it doesn't know", () => {
    expect(privacyVerdict("sgx", null, null)).toBe("unknown");
  });
});

describe("privacyVerdict with on-chain attestation", () => {
  const good = {
    status: "read",
    bindsKey: true,
    logMatchesQuote: true,
    appId: "0a1b",
    claimMatchesLog: true,
  } as const;

  test("passes when the contract itself verified the keeper's quote for the required app", () => {
    expect(privacyVerdict("phala", good, "0a1b", true)).toBe("pass");
  });

  test("fails when the contract has not accepted the keeper's key", () => {
    expect(privacyVerdict("phala", good, "0a1b", false)).toBe("fail");
  });

  test("stays partial while the contract's answer is unknown, or nothing is required", () => {
    expect(privacyVerdict("phala", good, "0a1b", null)).toBe("partial");
    expect(privacyVerdict("phala", good, null, true)).toBe("partial");
  });
});
