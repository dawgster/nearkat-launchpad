import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { Near, verifyNep413Signature } from "near-kit";
import { katSvg, sigilSvg } from "../../art/svg.ts";
import { stageOf } from "../../art/traits.ts";
import { createApp } from "./app.ts";
import { Auth } from "./auth.ts";
import { NearChain } from "./chain.ts";
import { Collections } from "./collections.ts";
import { loadConfig } from "./config.ts";
import { NearAiInference } from "./inference.ts";
import { KatService } from "./kats.ts";
import { keysFromRootSecret, localRootSecret } from "./keys.ts";
import { FileJournal, Meter } from "./meter.ts";
import { FileStore } from "./store.ts";
import { DstackAgent, keyProof, phalaCollateral, phalaRootSecret, reportDataFor } from "./tee.ts";

const WAKE_EVERY_MS = 5_000;
const CONSOLIDATE_EVERY_MS = 60_000;
const FLUSH_EVERY_MS = 5 * 60_000;
const DISCOVER_EVERY_MS = 30_000;

const config = loadConfig(process.env);
const dstack = config.mode === "phala" ? new DstackAgent(config.dstackEndpoint) : null;
// In phala mode the root secret comes from dstack's KMS, which hands it only
// to instances of this app: the operator never sees it.
const keys = keysFromRootSecret(
  dstack ? await phalaRootSecret(dstack) : localRootSecret(config.rootSecretHex),
);
const appInfo = dstack ? await dstack.info() : null;
// Fixed for the keeper's lifetime: the quote binds this key to this app instance.
const quote = dstack ? await dstack.getQuote(reportDataFor(keys.nearPublicKey())) : null;
const near = new Near({
  network: config.rpcUrl
    ? {
        rpcUrl: config.rpcUrl,
        networkId: config.network === "sandbox" ? "localnet" : config.network,
      }
    : (config.network as "testnet" | "mainnet"),
  privateKey: keys.nearPrivateKey(),
  defaultSignerId: config.keeperAccountId,
});

// Blobs are encrypted per collection and named by their hash, so one store serves all.
const store = new FileStore(config.storeDir);
const inference = new NearAiInference({
  baseUrl: config.nearAiBaseUrl,
  apiKey: config.nearAiApiKey,
  model: config.nearAiModel,
  maxTokens: config.maxTokens,
});
/** Each collection keeps its own journal: debit sequence numbers are per contract. */
const journalFor = (contractId: string) =>
  contractId === config.contractId
    ? config.meterJournal
    : join(dirname(config.meterJournal), `meter-${contractId}.json`);

const collections = new Collections({
  keeperAccountId: config.keeperAccountId,
  keeperPublicKey: keys.nearPublicKey(),
  runningAs: appInfo ? { mode: "phala", appId: appInfo.app_id } : { mode: "local" },
  chainFor: (contractId) => new NearChain(near, contractId),
  build: (contractId, chain, info) => {
    const meter = new Meter(chain, { journal: new FileJournal(journalFor(contractId)) });
    const kats = new KatService({
      chain,
      store,
      keys: keys.forContract(contractId),
      inference,
      meter,
      prices: { chat: config.chatPrice, save: config.savePrice },
      collection: info,
    });
    return { meter, kats };
  },
  proof: quote ? () => keyProof(keys.nearPublicKey(), quote, phalaCollateral) : undefined,
});

/** The collections to serve: the configured ones, and launches that name this keeper. */
async function discover(): Promise<void> {
  const ids = new Set([config.contractId, ...config.extraContractIds]);
  if (config.launchpadId) {
    for (let from = 0; ; from += 100) {
      const page =
        (await near.view<Array<{ account_id: string; live: boolean }>>(
          config.launchpadId,
          "get_collections",
          { from_index: String(from), limit: "100" },
        )) ?? [];
      for (const entry of page) {
        if (entry.live) {
          ids.add(entry.account_id);
        }
      }
      if (page.length < 100) {
        break;
      }
    }
  }
  // Collections that name another keeper are checked again on every pass, so
  // one that switches to this keeper is picked up.
  await Promise.all([...ids].map((id) => collections.add(id)));
}

const auth = new Auth({
  sessionKey: keys.sessionKey(),
  recipient: config.authRecipient,
  callbackOrigins: config.webOrigins,
  // The signature is checked locally first, so a forged request costs no RPC call.
  verify: async (signed, params) =>
    (await verifyNep413Signature(signed, params)) &&
    (await verifyNep413Signature(signed, params, { near })),
});
const app = createApp({
  auth,
  homeContractId: config.contractId,
  collection: (contractId) => {
    const served = collections.get(contractId)?.kats;
    // A launch this keeper hasn't found yet is checked as soon as someone asks
    // for it. Only launchpad accounts, so arbitrary ids can't make it read the chain.
    if (!served && config.launchpadId && contractId.endsWith(`.${config.launchpadId}`)) {
      void collections.add(contractId);
    }
    return served;
  },
  collections: () => ({
    home: config.contractId,
    served: collections.all().map(({ contractId, info }) => ({
      contract_id: contractId,
      name: info.name,
      tee: info.tee,
    })),
    waiting: collections.waiting().map(({ contractId, reason }) => ({
      contract_id: contractId,
      reason,
    })),
  }),
  art: async (contractId, tokenId) => {
    const served = collections.get(contractId);
    const kat = served ? await served.chain.getKat(tokenId) : null;
    if (!served || !kat) {
      return null;
    }
    // Drawn exactly as the web app draws it: kats for the home collection.
    const draw = contractId === config.contractId ? katSvg : sigilSvg;
    return draw(`${contractId}/${tokenId}`, stageOf(Number(kat.context_version) || 1), {
      title: `${served.info.name} #${tokenId}`,
    });
  },
  attestation: async () =>
    appInfo && quote
      ? {
          mode: "phala",
          keeper_public_key: keys.nearPublicKey(),
          app_id: appInfo.app_id,
          instance_id: appInfo.instance_id,
          compose_hash: appInfo.compose_hash,
          quote: quote.quote,
          event_log: quote.event_log,
        }
      : { mode: "local", keeper_public_key: keys.nearPublicKey() },
  info: {
    chat_price: config.chatPrice.toString(),
    save_price: config.savePrice.toString(),
    model: config.nearAiModel,
  },
  webOrigins: config.webOrigins,
});

/** Runs a background job on an interval, never overlapping itself. */
function every(ms: number, name: string, job: () => Promise<unknown>): void {
  let running = false;
  setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await job();
    } catch (error) {
      console.error(`${name} failed:`, error);
    } finally {
      running = false;
    }
  }, ms);
}

/** Runs a job for every served collection; one failing never stops the others. */
const forEach = (name: string, job: (kats: KatService, meter: Meter) => Promise<unknown>) => () =>
  Promise.all(
    collections
      .all()
      .map(({ contractId, kats, meter }) =>
        job(kats, meter).catch((error) =>
          console.error(`${name} failed for ${contractId}:`, error),
        ),
      ),
  );

void discover().catch((error) => console.error("discover failed:", error));
every(
  WAKE_EVERY_MS,
  "wake",
  forEach("wake", (kats) => kats.wakeNew()),
);
every(
  CONSOLIDATE_EVERY_MS,
  "consolidate",
  forEach("consolidate", (kats) => kats.consolidateIdle()),
);
every(FLUSH_EVERY_MS, "flush", async () => {
  await forEach("flush", (_, meter) => meter.flush())();
  // Earnings are only worth withdrawing once charges have settled on-chain.
  await collections.withdrawEarnings(config.withdrawMinimum);
});
every(DISCOVER_EVERY_MS, "discover", discover);

const server = serve({ fetch: app.fetch, port: config.port });
console.log(`Keeper listening on :${config.port} for ${config.contractId} (${config.network})`);
if (config.launchpadId) {
  console.log(`Also serving collections launched on ${config.launchpadId} that name this keeper`);
}
console.log(
  appInfo
    ? `Running as Phala app ${appInfo.app_id}; keys come from dstack`
    : "Running in local mode; the operator can read contexts",
);
console.log(`Keeper account ${config.keeperAccountId} must hold key ${keys.nearPublicKey()}`);

/** Warns, without stopping, when the keeper account cannot sign for the keeper. */
async function checkSetup(): Promise<void> {
  if (!(await near.getAccessKey(config.keeperAccountId, keys.nearPublicKey()))) {
    console.error(
      `SETUP PROBLEM: ${config.keeperAccountId} does not hold the key ${keys.nearPublicKey()}`,
    );
  }
}
checkSetup().catch((error) =>
  console.error("SETUP PROBLEM: cannot read the keeper account:", error),
);

/** Settles what it can before exiting; anything left is in the journals. */
async function shutdown(): Promise<void> {
  server.close();
  await forEach("final flush", (_, meter) => meter.flush())();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
