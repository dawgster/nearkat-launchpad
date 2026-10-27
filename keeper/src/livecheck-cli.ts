/**
 * `npm run live-check`: runs `liveCheck` against testnet or mainnet.
 *
 *   NEAR_NETWORK=testnet           (or mainnet)
 *   MPC_CONTRACT_ID                (default: v1.signer-prod.testnet / v1.signer)
 *   MPC_DOMAIN_ID                  (default: the first CKD domain)
 *   COLLECTION_ID, KEEPER_ACCOUNT_ID, KEEPER_ROOT_SECRET   (optional: check a collection,
 *                                   request its key and upload to FastFS as its keeper)
 *   NEAR_RPC_URL, NEAR_ARCHIVAL_RPC_URL, FASTFS_GATEWAY    (optional overrides)
 */
import { Near } from "near-kit";
import { NearChain, transactionArgsFrom } from "./chain.ts";
import { keysFromRootSecret, localRootSecret } from "./keys.ts";
import { liveCheck } from "./livecheck.ts";

const env = process.env;
const network = env.NEAR_NETWORK ?? "testnet";
if (network !== "testnet" && network !== "mainnet") {
  throw new Error("NEAR_NETWORK must be testnet or mainnet");
}
const keeperId = env.KEEPER_ACCOUNT_ID;
const keys = env.KEEPER_ROOT_SECRET
  ? keysFromRootSecret(localRootSecret(env.KEEPER_ROOT_SECRET))
  : null;
const near = new Near({
  network: env.NEAR_RPC_URL ? { rpcUrl: env.NEAR_RPC_URL, networkId: network } : network,
  ...(keys && keeperId ? { privateKey: keys.nearPrivateKey(), defaultSignerId: keeperId } : {}),
});
const gateway =
  env.FASTFS_GATEWAY !== undefined
    ? env.FASTFS_GATEWAY || null
    : network === "mainnet"
      ? "https://{uploader}.fastfs.io"
      : null;
const collectionId = env.COLLECTION_ID;

const results = await liveCheck({
  view: (contractId, method, args) => near.view(contractId, method, args),
  mpcContractId:
    env.MPC_CONTRACT_ID ?? (network === "mainnet" ? "v1.signer" : "v1.signer-prod.testnet"),
  domainId: env.MPC_DOMAIN_ID ? Number(env.MPC_DOMAIN_ID) : undefined,
  collection:
    collectionId && keeperId && keys
      ? {
          id: collectionId,
          keeperId,
          chain: new NearChain(near, collectionId, { signerId: keeperId, finality: "optimistic" }),
        }
      : undefined,
  fastfs: {
    gatewayUrl: gateway
      ? (uploader, receiver, path) =>
          `${gateway.replace("{uploader}", uploader)}/${receiver}/${path}`
      : null,
    transactionArgs: transactionArgsFrom(
      env.NEAR_ARCHIVAL_RPC_URL || `https://archival-rpc.${network}.fastnear.com`,
    ),
  },
  log: console.log,
});
process.exitCode = results.some((result) => result.ok === false) ? 1 : 0;
