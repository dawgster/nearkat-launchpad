export interface AppConfig {
  networkId: "testnet" | "mainnet" | "sandbox";
  /** A custom RPC endpoint. Null means the network's default. */
  rpcUrl: string | null;
  contractId: string;
  keeperUrl: string;
  /** The recipient the keeper's sign-in message must name. Anything else is not signed. */
  authRecipient: string;
  /** Development only: sign with this key instead of a browser wallet. */
  devWallet: { accountId: string; privateKey: string } | null;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env, options: { production?: boolean } = {}): AppConfig {
  const contractId = env.VITE_CONTRACT_ID;
  if (!contractId) {
    throw new Error("VITE_CONTRACT_ID is not set");
  }
  const networkId = env.VITE_NEAR_NETWORK ?? "testnet";
  if (networkId !== "testnet" && networkId !== "mainnet" && networkId !== "sandbox") {
    throw new Error("VITE_NEAR_NETWORK must be testnet, mainnet or sandbox");
  }
  if (networkId === "sandbox" && !env.VITE_NEAR_RPC_URL) {
    throw new Error("VITE_NEAR_RPC_URL is required when VITE_NEAR_NETWORK is sandbox");
  }
  if (options.production && !env.VITE_KEEPER_URL) {
    throw new Error("VITE_KEEPER_URL is not set");
  }
  const devWallet =
    env.VITE_DEV_WALLET_ID && env.VITE_DEV_WALLET_KEY
      ? { accountId: env.VITE_DEV_WALLET_ID, privateKey: env.VITE_DEV_WALLET_KEY }
      : null;
  if (devWallet && options.production) {
    throw new Error("The dev wallet cannot be used in a production build");
  }
  if (devWallet && networkId === "mainnet") {
    throw new Error("The dev wallet cannot be used on mainnet");
  }
  return {
    networkId,
    rpcUrl: env.VITE_NEAR_RPC_URL || null,
    contractId,
    keeperUrl: (env.VITE_KEEPER_URL ?? "http://localhost:8787").replace(/\/+$/, ""),
    authRecipient: env.VITE_AUTH_RECIPIENT ?? "nearkat.xyz",
    devWallet,
  };
}

/** The network in the form near-kit takes it. */
export function nearNetwork(
  config: AppConfig,
): "testnet" | "mainnet" | { rpcUrl: string; networkId: string } {
  if (config.rpcUrl) {
    return {
      rpcUrl: config.rpcUrl,
      networkId: config.networkId === "sandbox" ? "localnet" : config.networkId,
    };
  }
  return config.networkId as "testnet" | "mainnet";
}
