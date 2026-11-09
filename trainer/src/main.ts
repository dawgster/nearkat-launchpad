import { serve } from "@hono/node-server";
import { Near, verifyNep413Signature } from "near-kit";
import { Auth } from "../../keeper/src/auth.ts";
import { transactionArgsFrom } from "../../keeper/src/chain.ts";
import { keysFromRootSecret, localRootSecret } from "../../keeper/src/keys.ts";
import {
  DstackAgent,
  keyProof,
  phalaCollateral,
  phalaRootSecret,
  reportDataFor,
} from "../../keeper/src/tee.ts";
import { createApp } from "./app.ts";
import { NearTrainerChain } from "./chain.ts";
import { loadConfig } from "./config.ts";
import { countHeldout } from "./heldout.ts";
import { runPython } from "./python.ts";
import { ensureRegistered } from "./register.ts";
import { Runs } from "./run.ts";

const config = loadConfig(process.env);
const dstack = config.mode === "phala" ? new DstackAgent(config.dstackEndpoint) : null;
// In phala mode the root secret comes from dstack's KMS, which hands it only
// to instances of this app: the operator never sees it.
const keys = keysFromRootSecret(
  dstack ? await phalaRootSecret(dstack) : localRootSecret(config.rootSecretHex),
);
const appInfo = dstack ? await dstack.info() : null;
const appId = appInfo ? appInfo.app_id : config.appId;
const publicKey = keys.nearPublicKey();
// Fixed for the app's lifetime: the quote binds this key to this app instance.
const sealKey = keys.sealing().publicKeyHex;
const quote = dstack ? await dstack.getQuote(reportDataFor(publicKey, sealKey)) : null;

// The key is the full-access key of the trainer's account: record_training and
// register_app_key take deposits, and the latter is signed by the key it registers.
const near = new Near({
  network: config.rpcUrl
    ? {
        rpcUrl: config.rpcUrl,
        networkId: config.network === "sandbox" ? "localnet" : config.network,
      }
    : (config.network as "testnet" | "mainnet"),
  privateKey: keys.nearPrivateKey(),
  defaultSignerId: config.trainerAccountId,
});
const chain = new NearTrainerChain(near, {
  signerId: config.trainerAccountId,
  transactionArgs: transactionArgsFrom(config.archivalRpcUrl),
  gatewayUrl: config.fastfsGateway
    ? (uploader, receiver, path) =>
        `${(config.fastfsGateway as string).replace("{uploader}", uploader)}/${receiver}/${path}`
    : null,
});

const runs = new Runs({
  appId,
  appPublicKey: () => publicKey,
  chain,
  python: runPython,
  heldoutDir: config.heldoutDir,
  keysPerCall: config.sampleKeysPerCall,
  epochs: config.epochs,
  ensureRegistered: ensureRegistered({
    chain,
    mode: config.mode,
    appId,
    publicKey,
    label: config.label,
    proof: async () => {
      if (!quote) {
        throw new Error("No attestation quote outside phala mode");
      }
      return keyProof(publicKey, sealKey, quote, phalaCollateral);
    },
  }),
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

const heldout = countHeldout(config.heldoutDir);
const app = createApp({
  auth,
  runs,
  attestation: async () => ({
    mode: config.mode,
    app_id: appId,
    public_key: publicKey,
    seal_public_key: sealKey,
    ...(appInfo && quote
      ? { quote: quote.quote, event_log: quote.event_log, compose_hash: appInfo.compose_hash }
      : {}),
  }),
  info: { app_id: appId, label: config.label, classes_supported: "any", heldout },
  webOrigins: config.webOrigins,
  trustProxy: process.env.TRUST_PROXY === "true",
});

const server = serve({ fetch: app.fetch, port: config.port });
console.log(`Trainer listening on :${config.port} as app ${appId} (${config.network})`);
console.log(
  appInfo
    ? "Running as a Phala app; keys come from dstack"
    : "Running in local mode; the operator holds the keys",
);
console.log(`${heldout} held-out images in ${config.heldoutDir}`);
console.log(
  `Trainer account ${config.trainerAccountId} must hold the full-access key ${publicKey}`,
);

/** Warns, without stopping, when the account can't sign for the trainer. */
near
  .getAccessKey(config.trainerAccountId, publicKey)
  .then((key) => {
    if (!key) {
      console.error(`SETUP PROBLEM: ${config.trainerAccountId} does not hold the key ${publicKey}`);
    }
  })
  .catch(() => console.error("SETUP PROBLEM: cannot read the trainer account"));

process.once("SIGTERM", () => server.close());
process.once("SIGINT", () => server.close());
