import { serve } from "@hono/node-server";
import { Near, verifyNep413Signature } from "near-kit";
import { createApp } from "./app.ts";
import { Auth } from "./auth.ts";
import { NearChain } from "./chain.ts";
import { loadConfig } from "./config.ts";
import { NearAiInference } from "./inference.ts";
import { KatService } from "./kats.ts";
import { keysFromRootSecret, localRootSecret } from "./keys.ts";
import { Meter } from "./meter.ts";
import { FileStore } from "./store.ts";

const WAKE_EVERY_MS = 5_000;
const CONSOLIDATE_EVERY_MS = 60_000;
const FLUSH_EVERY_MS = 5 * 60_000;

const config = loadConfig(process.env);
const keys = keysFromRootSecret(localRootSecret(config.rootSecretHex));
const near = new Near({
  network: config.network,
  privateKey: keys.nearPrivateKey(),
  defaultSignerId: config.keeperAccountId,
});
const chain = new NearChain(near, config.contractId);
const meter = new Meter(chain);
const kats = new KatService({
  chain,
  store: new FileStore(config.storeDir),
  keys,
  inference: new NearAiInference({
    baseUrl: config.nearAiBaseUrl,
    apiKey: config.nearAiApiKey,
    model: config.nearAiModel,
  }),
  meter,
  prices: { chat: config.chatPrice, save: config.savePrice },
});
const auth = new Auth({
  sessionKey: keys.sessionKey(),
  recipient: config.authRecipient,
  verify: (signed, params) => verifyNep413Signature(signed, params, { near }),
});
const app = createApp({
  auth,
  kats,
  attestation: async () => ({ mode: "local", keeper_public_key: keys.nearPublicKey() }),
  webOrigin: config.webOrigin,
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

serve({ fetch: app.fetch, port: config.port });
console.log(`Keeper listening on :${config.port} for ${config.contractId} (${config.network})`);
console.log(`Keeper account ${config.keeperAccountId} must hold key ${keys.nearPublicKey()}`);
