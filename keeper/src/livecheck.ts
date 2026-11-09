import { randomBytes } from "node:crypto";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { base58 } from "@scure/base";
import type { Chain } from "./chain.ts";
import { fetchContextRoot, type KeySource } from "./ckd.ts";
import { FastfsStore } from "./fastfs.ts";

/**
 * Checks the pieces this keeper relies on against a live network: NEAR's MPC
 * contract and its CKD domain, a collection's key source, a real context-key
 * request, and a FastFS upload read back through the gateway and an archival
 * node. Each step says what it found; later steps are skipped when what they
 * need is missing.
 */
export interface LiveCheckDeps {
  /** A read-only view call on any contract. */
  view(contractId: string, method: string, args: Record<string, unknown>): Promise<unknown>;
  mpcContractId: string;
  /** The CKD domain to use; found from the MPC contract's state when absent. */
  domainId?: number;
  /** A collection to check, and a chain signed by its keeper. */
  collection?: { id: string; keeperId: string; chain: Chain };
  fastfs?: {
    gatewayUrl: ((uploader: string, receiver: string, path: string) => string) | null;
    transactionArgs(txHash: string, sender: string): Promise<Uint8Array[]>;
  };
  /** How long to wait for an indexer or a view to catch up. */
  waitMs?: number;
  log?: (line: string) => void;
}

export type CheckResult = { name: string; ok: boolean | null; detail: string };

/** Every CKD domain id in the MPC contract's `state`, wherever it sits in that structure. */
export function ckdDomains(state: unknown): number[] {
  return domainsWhere(state, (domain) => domain.purpose === "CKD");
}

function domainsWhere(
  state: unknown,
  matches: (domain: Record<string, unknown>) => boolean,
): number[] {
  const found = new Set<number>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (matches(record) && (typeof record.id === "number" || typeof record.id === "string")) {
        found.add(Number(record.id));
      }
      Object.values(record).forEach(visit);
    }
  };
  visit(state);
  return [...found].sort((a, b) => a - b);
}

async function eventually<T>(waitMs: number, run: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return await run();
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

export async function liveCheck(deps: LiveCheckDeps): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const log = deps.log ?? (() => {});
  const waitMs = deps.waitMs ?? 60_000;
  const record = (name: string, ok: boolean | null, detail: string) => {
    results.push({ name, ok, detail });
    log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
  };
  const step = async (name: string, run: () => Promise<string>): Promise<boolean> => {
    try {
      record(name, true, await run());
      return true;
    } catch (error) {
      record(name, false, error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  let domainId = deps.domainId;
  await step("MPC contract has a CKD domain", async () => {
    const domains = ckdDomains(await deps.view(deps.mpcContractId, "state", {}));
    if (domains.length === 0) {
      throw new Error(`${deps.mpcContractId} lists no CKD domain`);
    }
    if (domainId !== undefined && !domains.includes(domainId)) {
      throw new Error(`domain ${domainId} is not a CKD domain; CKD domains: ${domains.join(", ")}`);
    }
    domainId ??= domains[0];
    return `CKD domains ${domains.join(", ")}; using ${domainId}`;
  });
  if (domainId === undefined) {
    return results;
  }
  const source: KeySource = { mpc_contract_id: deps.mpcContractId, domain_id: domainId };

  await step("MPC public key is a BLS12-381 G2 point", async () => {
    const key = await deps.view(deps.mpcContractId, "public_key", { domain_id: domainId });
    if (typeof key !== "string" || !key.startsWith("bls12381g2:")) {
      throw new Error(`unexpected public key ${JSON.stringify(key)}`);
    }
    bls.G2.Point.fromBytes(base58.decode(key.slice("bls12381g2:".length))).assertValidity();
    return key;
  });

  const collection = deps.collection;
  if (!collection) {
    record("Collection", null, "set COLLECTION_ID and the keeper's credentials to check one");
    return results;
  }
  const keySourceOk = await step("Collection takes its keys from this MPC domain", async () => {
    const info = await collection.chain.getCollection();
    if (
      info.key_source?.mpc_contract_id !== source.mpc_contract_id ||
      Number(info.key_source.domain_id) !== source.domain_id
    ) {
      throw new Error(`it names ${JSON.stringify(info.key_source)}`);
    }
    const keeper = await collection.chain.getKeeperId();
    if (keeper !== collection.keeperId) {
      throw new Error(`its keeper is ${keeper}, not ${collection.keeperId}`);
    }
    return `key epoch ${info.key_epoch}, keeper ${keeper}`;
  });
  if (keySourceOk) {
    await step("Context key from the MPC network, twice, matches", async () => {
      const epoch = await collection.chain.getKeyEpoch();
      const started = Date.now();
      const first = await fetchContextRoot(collection.id, source, collection.chain, epoch);
      const took = Date.now() - started;
      const second = await fetchContextRoot(collection.id, source, collection.chain, epoch);
      if (!first.equals(second)) {
        throw new Error("two requests gave different keys");
      }
      return `epoch ${epoch}; first request took ${(took / 1000).toFixed(1)} s`;
    });
  }

  const fastfs = deps.fastfs;
  if (!fastfs) {
    record("FastFS", null, "no archival RPC configured");
    return results;
  }
  const store = (gatewayUrl: typeof fastfs.gatewayUrl, transactionArgs = fastfs.transactionArgs) =>
    new FastfsStore({
      uploader: collection.keeperId,
      receiver: collection.id,
      upload: (_receiver, args) => collection.chain.uploadFastfs(args),
      uploadMany: (_receiver, list) => collection.chain.uploadFastfsMany(list),
      transactionArgs,
      gatewayUrl,
    });
  const blob = randomBytes(64);
  let ref: string | null = null;
  await step("FastFS upload", async () => {
    ref = await store(null).put(blob);
    return ref;
  });
  if (!ref) {
    return results;
  }
  const uploaded: string = ref;
  await step("FastFS read back from an archival node", async () => {
    const read = await eventually(waitMs, () => store(null).get(uploaded));
    if (!Buffer.from(read).equals(blob)) {
      throw new Error("the archival node returned other bytes");
    }
    return "matches";
  });
  if (!fastfs.gatewayUrl) {
    record("FastFS read back from the gateway", null, "no gateway on this network");
    return results;
  }
  const noChain = async () => {
    throw new Error("reading from the gateway only");
  };
  await step("FastFS read back from the gateway", async () => {
    const read = await eventually(waitMs, () => store(fastfs.gatewayUrl, noChain).get(uploaded));
    if (!Buffer.from(read).equals(blob)) {
      throw new Error("the gateway returned other bytes");
    }
    return "matches";
  });
  return results;
}
