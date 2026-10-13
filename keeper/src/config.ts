export interface Config {
  network: "testnet" | "mainnet";
  contractId: string;
  keeperAccountId: string;
  rootSecretHex: string | undefined;
  nearAiBaseUrl: string;
  nearAiApiKey: string;
  nearAiModel: string;
  storeDir: string;
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

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const network = env.NEAR_NETWORK ?? "testnet";
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("NEAR_NETWORK must be testnet or mainnet");
  }
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a port number");
  }
  return {
    network,
    contractId: required(env, "CONTRACT_ID"),
    keeperAccountId: required(env, "KEEPER_ACCOUNT_ID"),
    rootSecretHex: env.KEEPER_ROOT_SECRET,
    nearAiBaseUrl: env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai/v1",
    nearAiApiKey: required(env, "NEAR_AI_API_KEY"),
    nearAiModel: env.NEAR_AI_MODEL ?? "zai-org/GLM-5.1-FP8",
    storeDir: env.STORE_DIR ?? "./data/contexts",
    port,
    authRecipient: env.AUTH_RECIPIENT ?? "nearkat.xyz",
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
    // 0.002 NEAR and 0.05 NEAR
    chatPrice: BigInt(env.CHAT_PRICE_YOCTO ?? "2000000000000000000000"),
    savePrice: BigInt(env.SAVE_PRICE_YOCTO ?? "50000000000000000000000"),
  };
}
