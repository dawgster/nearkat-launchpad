import { serve } from "@hono/node-server";
import { Near, verifyNep413Signature } from "near-kit";
import { createApp } from "./app.ts";
import { Auth } from "./auth.ts";
import { NearChain } from "./chain.ts";
import type { CollectionInfo } from "./collection.ts";
import { loadConfig } from "./config.ts";
import { NearAiInference } from "./inference.ts";
import { KatService } from "./kats.ts";
import { keysFromRootSecret, localRootSecret } from "./keys.ts";
import { FileJournal, Meter } from "./meter.ts";
import { FileStore } from "./store.ts";
import { DstackAgent, phalaRootSecret, reportDataFor, teeMismatch } from "./tee.ts";

const WAKE_EVERY_MS = 5_000;
const CONSOLIDATE_EVERY_MS = 60_000;
const FLUSH_EVERY_MS = 5 * 60_000;

const config = loadConfig(process.env);
const dstack = config.mode === "phala" ? new DstackAgent(config.dstackEndpoint) : null;
// In phala mode the root secret comes from dstack's KMS, which hands it only
// to instances of this app: the operator never sees it.
const keys = keysFromRootSecret(
  dstack ? await phalaRootSecret(dstack) : localRootSecret(config.rootSecretHex),
);
const appInfo = dstack ? await dstack.info() : null;
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
const chain = new NearChain(near, config.contractId);

/**
 * The collection, read once from the contract. It is read on first need, not
 * at start: the keeper must already be up to report its key before the
 * contract it serves can be deployed. Nothing is woken or answered until the
 * collection has been read and its TEE requirement checked.
 */
let collectionRead: Promise<CollectionInfo> | null = null;
function collection(): Promise<CollectionInfo> {
  collectionRead ??= chain.getCollection().then(
    (info) => {
      const mismatch = teeMismatch(
        info,
        appInfo ? { mode: "phala", appId: appInfo.app_id } : { mode: "local" },
      );
      if (mismatch) {
        // Serving would put contexts somewhere the collection promised they would not be.
        console.error(`REFUSING TO SERVE: ${mismatch}`);
        process.exit(1);
      }
      return info;
    },
    (error) => {
      collectionRead = null;
      throw error;
    },
  );
  return collectionRead;
}
// Fixed for the keeper's lifetime: the quote binds this key to this app instance.
const quote = dstack ? await dstack.getQuote(reportDataFor(keys.nearPublicKey())) : null;
const meter = new Meter(chain, { journal: new FileJournal(config.meterJournal) });
const kats = new KatService({
  chain,
  store: new FileStore(config.storeDir),
  keys,
  inference: new NearAiInference({
    baseUrl: config.nearAiBaseUrl,
    apiKey: config.nearAiApiKey,
    model: config.nearAiModel,
    maxTokens: config.maxTokens,
  }),
  meter,
  prices: { chat: config.chatPrice, save: config.savePrice },
  collection,
});
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
  kats,
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

every(WAKE_EVERY_MS, "wake", () => kats.wakeNew());
every(CONSOLIDATE_EVERY_MS, "consolidate", () => kats.consolidateIdle());
every(FLUSH_EVERY_MS, "flush", () => meter.flush());

const server = serve({ fetch: app.fetch, port: config.port });
console.log(`Keeper listening on :${config.port} for ${config.contractId} (${config.network})`);
console.log(
  appInfo
    ? `Running as Phala app ${appInfo.app_id}; keys come from dstack`
    : "Running in local mode; the operator can read contexts",
);
console.log(`Keeper account ${config.keeperAccountId} must hold key ${keys.nearPublicKey()}`);

/** Warns, without stopping, about a setup in which no kat could ever be woken or charged. */
async function checkSetup(): Promise<void> {
  const info = await collection();
  console.log(
    info.tee
      ? `Serving ${info.name}, which requires Phala app ${info.tee.Phala.app_id}`
      : `Serving ${info.name}`,
  );
  const registered = await chain.getKeeperId();
  if (registered !== config.keeperAccountId) {
    console.error(
      `SETUP PROBLEM: the contract accepts keeper calls from ${registered}, not ${config.keeperAccountId}`,
    );
  }
  if (!(await near.getAccessKey(config.keeperAccountId, keys.nearPublicKey()))) {
    console.error(
      `SETUP PROBLEM: ${config.keeperAccountId} does not hold the key ${keys.nearPublicKey()}`,
    );
  }
}
checkSetup().catch((error) => console.error("SETUP PROBLEM: cannot read the contract:", error));

/** Settles what it can before exiting; anything left is in the journal. */
async function shutdown(): Promise<void> {
  server.close();
  try {
    await meter.flush();
  } catch (error) {
    console.error("Final flush failed; charges remain in the journal:", error);
  }
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
