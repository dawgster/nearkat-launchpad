export interface Config {
  /** "local": root secret from the environment. "phala": from dstack's KMS, inside a Phala app. */
  mode: "local" | "phala";
  /** The dstack guest agent. Defaults to its unix socket; a URL reaches the simulator. */
  dstackEndpoint: string | undefined;
  network: "testnet" | "mainnet" | "sandbox";
  /** Overrides the network's default RPC endpoint. Required for a sandbox. */
  rpcUrl: string | undefined;
  trainerAccountId: string;
  rootSecretHex: string | undefined;
  /** Local mode only; in phala mode the app id comes from dstack. */
  appId: string;
  /**
   * The launchpad whose collections this app trains on; null trains on any
   * (local mode only). Required in phala mode.
   */
  launchpadId: string | null;
  /** What the collection lists this app as. */
  label: string;
  /** The held-out images, `<dir>/<class>/*.jpg`. */
  heldoutDir: string;
  archivalRpcUrl: string;
  /** Serves FastFS files over HTTP; `{uploader}` is filled in. Null: read from the chain only. */
  fastfsGateway: string | null;
  /** Sample keys asked for per call to the collection, 1 to 10. 1 for the sandbox's mock MPC. */
  sampleKeysPerCall: number;
  /** Epochs per run; undefined leaves train.py's default. */
  epochs: number | undefined;
  port: number;
  authRecipient: string;
  /** Origins the web app is served from, for CORS. */
  webOrigins: string[];
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

/** Sample keys asked for per call: 1 to 10. Use 1 with the sandbox's mock MPC, which costs ~120 Tgas per key. */
function sampleKeysPerCall(env: NodeJS.ProcessEnv): number {
  const value = Number(env.SAMPLE_KEYS_PER_CALL ?? "10");
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("SAMPLE_KEYS_PER_CALL must be a whole number from 1 to 10");
  }
  return value;
}

/** Epochs per run, 1 to 1000; unset leaves train.py's default. */
function epochs(env: NodeJS.ProcessEnv): number | undefined {
  if (!env.TRAINER_EPOCHS) {
    return undefined;
  }
  const value = Number(env.TRAINER_EPOCHS);
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error("TRAINER_EPOCHS must be a whole number from 1 to 1000");
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const network = env.NEAR_NETWORK ?? "testnet";
  if (network !== "testnet" && network !== "mainnet" && network !== "sandbox") {
    throw new Error("NEAR_NETWORK must be testnet, mainnet or sandbox");
  }
  if (network === "sandbox" && !env.NEAR_RPC_URL) {
    throw new Error("NEAR_RPC_URL is required when NEAR_NETWORK is sandbox");
  }
  const mode = env.TRAINER_MODE ?? "local";
  if (mode !== "local" && mode !== "phala") {
    throw new Error("TRAINER_MODE must be local or phala");
  }
  if (mode === "phala" && env.TRAINER_ROOT_SECRET) {
    // A secret from the environment is one the operator knows: refuse rather than ignore it.
    throw new Error("TRAINER_ROOT_SECRET must not be set in phala mode; keys come from dstack");
  }
  if (mode === "local" && !/^[0-9a-fA-F]{64}$/.test(env.TRAINER_ROOT_SECRET ?? "")) {
    throw new Error("TRAINER_ROOT_SECRET must be 64 hex characters in local mode");
  }
  if (mode === "phala" && !env.TRAINER_LAUNCHPAD_ID) {
    throw new Error("TRAINER_LAUNCHPAD_ID is required in phala mode");
  }
  const port = Number(env.PORT ?? "8790");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a port number");
  }
  return {
    mode,
    dstackEndpoint: env.DSTACK_ENDPOINT || undefined,
    network,
    rpcUrl: env.NEAR_RPC_URL || undefined,
    trainerAccountId: required(env, "TRAINER_ACCOUNT_ID"),
    rootSecretHex: env.TRAINER_ROOT_SECRET || undefined,
    launchpadId: env.TRAINER_LAUNCHPAD_ID || null,
    appId: env.TRAINER_APP_ID || "local-trainer",
    label: env.TRAINER_LABEL || "Hotdog CNN",
    heldoutDir: env.HELDOUT_DIR ?? "./data/heldout",
    archivalRpcUrl:
      env.ARCHIVAL_RPC_URL ||
      (network === "sandbox"
        ? (env.NEAR_RPC_URL as string)
        : `https://archival-rpc.${network}.fastnear.com`),
    fastfsGateway:
      env.FASTFS_GATEWAY !== undefined
        ? env.FASTFS_GATEWAY || null
        : network === "mainnet"
          ? "https://{uploader}.fastfs.io"
          : null,
    sampleKeysPerCall: sampleKeysPerCall(env),
    epochs: epochs(env),
    port,
    authRecipient: env.AUTH_RECIPIENT ?? "nearkat.xyz",
    webOrigins: (env.WEB_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
