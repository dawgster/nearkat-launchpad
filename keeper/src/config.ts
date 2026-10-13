export interface Config {
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
  webOrigin: string;
  /** yoctoNEAR */
  chatPrice: bigint;
  /** yoctoNEAR */
  savePrice: bigint;
}

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
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a port number");
  }
  const maxTokens = Number(env.NEAR_AI_MAX_TOKENS ?? "1024");
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error("NEAR_AI_MAX_TOKENS must be a positive whole number");
  }
  return {
    network,
    rpcUrl: env.NEAR_RPC_URL || undefined,
    contractId: required(env, "CONTRACT_ID"),
    keeperAccountId: required(env, "KEEPER_ACCOUNT_ID"),
    rootSecretHex: env.KEEPER_ROOT_SECRET,
    nearAiBaseUrl: env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai/v1",
    nearAiApiKey: required(env, "NEAR_AI_API_KEY"),
    nearAiModel: env.NEAR_AI_MODEL ?? "zai-org/GLM-5.1-FP8",
    storeDir: env.STORE_DIR ?? "./data/contexts",
    meterJournal: env.METER_JOURNAL ?? "./data/meter.json",
    maxTokens,
    port,
    authRecipient: env.AUTH_RECIPIENT ?? "nearkat.xyz",
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
    // 0.002 NEAR and 0.05 NEAR
    chatPrice: yocto(env, "CHAT_PRICE_YOCTO", "2000000000000000000000"),
    savePrice: yocto(env, "SAVE_PRICE_YOCTO", "50000000000000000000000"),
  };
}
