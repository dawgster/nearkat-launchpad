import { describe, expect, test } from "vitest";
import { ckdDomains, ed25519Domains, liveCheck } from "../src/livecheck.ts";
import { FakeChain } from "./fakes.ts";

/** Shaped like the MPC contract's `state` view: domains are nested deep inside it. */
const STATE = {
  Running: {
    domains: {
      domains: [
        { id: 0, protocol: "CaitSith", purpose: "Sign" },
        { id: 1, protocol: "Frost", purpose: "Sign" },
        { id: 2, scheme: "Bls12381", purpose: "CKD" },
      ],
    },
  },
};

function setup() {
  const chain = new FakeChain();
  chain.contractId = "lantern.testnet";
  chain.keeperId = "keeper.testnet";
  chain.collection = {
    ...chain.collection,
    key_source: { mpc_contract_id: "v1.signer-prod.testnet", domain_id: 2 },
  };
  const view = async (_contract: string, method: string) =>
    method === "state" ? STATE : chain.mpcPublicKey(chain.collection.key_source);
  return { chain, view };
}

describe("ckdDomains", () => {
  test("finds CKD domains wherever they sit in the state", () => {
    expect(ckdDomains(STATE)).toEqual([2]);
    expect(ed25519Domains(STATE)).toEqual([1]);
    expect(ckdDomains({ nothing: [] })).toEqual([]);
  });
});

describe("liveCheck", () => {
  test("passes every step against a network that behaves", async () => {
    const { chain, view } = setup();
    const results = await liveCheck({
      view,
      mpcContractId: "v1.signer-prod.testnet",
      collection: { id: "lantern.testnet", keeperId: "keeper.testnet", chain },
      fastfs: {
        gatewayUrl: null,
        transactionArgs: async (hash) => chain.uploads.get(hash) ?? new Uint8Array(),
      },
      waitMs: 0,
    });
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ["MPC contract has a CKD domain", true],
      ["MPC public key is a BLS12-381 G2 point", true],
      ["MPC contract has an Ed25519 signing domain, for token wallets", true],
      ["Collection takes its keys from this MPC domain", true],
      ["Context key from the MPC network, twice, matches", true],
      ["FastFS upload", true],
      ["FastFS read back from an archival node", true],
      ["FastFS read back from the gateway", null],
    ]);
  });

  test("says when the chosen domain isn't a CKD domain", async () => {
    const { view } = setup();
    const [first] = await liveCheck({ view, mpcContractId: "v1.signer-prod.testnet", domainId: 0 });
    expect(first).toMatchObject({ ok: false, detail: expect.stringMatching(/not a CKD domain/) });
  });

  test("fails a collection that names another key source", async () => {
    const { chain, view } = setup();
    chain.collection = {
      ...chain.collection,
      key_source: { mpc_contract_id: "evil", domain_id: 2 },
    };
    const results = await liveCheck({
      view,
      mpcContractId: "v1.signer-prod.testnet",
      collection: { id: "lantern.testnet", keeperId: "keeper.testnet", chain },
      waitMs: 0,
    });
    expect(results[3]).toMatchObject({ ok: false, detail: expect.stringMatching(/evil/) });
    expect(results.find((r) => r.name.startsWith("Context key"))).toBeUndefined();
  });
});
