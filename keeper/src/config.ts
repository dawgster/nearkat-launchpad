export interface Config {
  /** "local": root secret from the environment. "phala": from dstack's KMS, inside a Phala app. */
  mode: "local" | "phala";
  /** The dstack guest agent. Defaults to its unix socket; a URL reaches the simulator. */
  dstackEndpoint: string | undefined;
  network: "testnet" | "mainnet" | "sandbox";
  /** Overrides the network's default RPC endpoint. Required for a sandbox. */
  rpcUrl: string | undefined;
  contractId: string;
  keeperAccountId: string;
  rootSecretHex: string | undefined;
  nearAiBaseUrl: string;
  nearAiApiKey: string;
  nearAiModel: string;
  storeDir: string;
  meterJournal: string;
  /** Upper bound on reply length, in tokens. */
  maxTokens: number;
  port: number;
  authRecipient: string;
  /** Origins the web app is served from, for CORS. */
  webOrigins: string[];
  /** yoctoNEAR */
  chatPrice: bigint;
  /** yoctoNEAR */
  savePrice: bigint;
}

/**
 * Must be a canonical model id, not an alias: the keeper asks NEAR AI not to
 * resolve aliases, because the model id is part of the signed text. This one
 * runs in NEAR AI's own enclave, so its replies carry an enclave signature.
 */
const DEFAULT_MODEL = "z-ai/glm-5.3-flash";
/**
 * The default model reasons before it answers, and that reasoning counts
 * against the limit: at 200 tokens it never reaches its answer.
 */
const DEFAULT_MAX_TOKENS = "2048";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function yocto(env: NodeJS.ProcessEnv, name: string, fallback: string): bigint {
  const value = env[name] ?? fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative whole number of yoctoNEAR`);
  }
  return BigInt(value);
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const network = env.NEAR_NETWORK ?? "testnet";
  if (network !== "testnet" && network !== "mainnet" && network !== "sandbox") {
    throw new Error("NEAR_NETWORK must be testnet, mainnet or sandbox");
  }
  if (network === "sandbox" && !env.NEAR_RPC_URL) {
    throw new Error("NEAR_RPC_URL is required when NEAR_NETWORK is sandbox");
  }
  const mode = env.KEEPER_MODE ?? "local";
  if (mode !== "local" && mode !== "phala") {
    throw new Error("KEEPER_MODE must be local or phala");
  }
  if (mode === "phala" && env.KEEPER_ROOT_SECRET) {
    // A secret from the environment is one the operator knows: refuse rather than ignore it.
    throw new Error("KEEPER_ROOT_SECRET must not be set in phala mode; keys come from dstack");
  }
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a port number");
  }
  const maxTokens = Number(env.NEAR_AI_MAX_TOKENS ?? DEFAULT_MAX_TOKENS);
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error("NEAR_AI_MAX_TOKENS must be a positive whole number");
  }
  return {
    mode,
    dstackEndpoint: env.DSTACK_ENDPOINT || undefined,
    network,
    rpcUrl: env.NEAR_RPC_URL || undefined,
    contractId: required(env, "CONTRACT_ID"),
    keeperAccountId: required(env, "KEEPER_ACCOUNT_ID"),
    rootSecretHex: env.KEEPER_ROOT_SECRET,
    nearAiBaseUrl: env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai/v1",
    nearAiApiKey: required(env, "NEAR_AI_API_KEY"),
    nearAiModel: env.NEAR_AI_MODEL ?? DEFAULT_MODEL,
    storeDir: env.STORE_DIR ?? "./data/contexts",
    meterJournal: env.METER_JOURNAL ?? "./data/meter.json",
    maxTokens,
    port,
    authRecipient: env.AUTH_RECIPIENT ?? "nearkat.xyz",
    webOrigins: (env.WEB_ORIGIN ?? "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    // 0.002 NEAR and 0.05 NEAR
    chatPrice: yocto(env, "CHAT_PRICE_YOCTO", "2000000000000000000000"),
    savePrice: yocto(env, "SAVE_PRICE_YOCTO", "50000000000000000000000"),
  };
}
