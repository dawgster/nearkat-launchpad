export interface AppConfig {
  /** A network name, or a custom RPC endpoint for a local sandbox. */
  network: "testnet" | "mainnet" | { rpcUrl: string; networkId: string };
  contractId: string;
  keeperUrl: string;
  /** Test-only: sign with this key instead of a browser wallet. */
  devWallet: { accountId: string; privateKey: string } | null;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): AppConfig {
  const contractId = env.VITE_CONTRACT_ID;
  if (!contractId) {
    throw new Error("VITE_CONTRACT_ID is not set");
  }
  const network = env.VITE_NEAR_NETWORK ?? "testnet";
  if (network !== "testnet" && network !== "mainnet" && network !== "sandbox") {
    throw new Error("VITE_NEAR_NETWORK must be testnet, mainnet or sandbox");
  }
  if (network === "sandbox" && !env.VITE_NEAR_RPC_URL) {
    throw new Error("VITE_NEAR_RPC_URL is required when VITE_NEAR_NETWORK is sandbox");
  }
  const devWallet =
    env.VITE_DEV_WALLET_ID && env.VITE_DEV_WALLET_KEY
      ? { accountId: env.VITE_DEV_WALLET_ID, privateKey: env.VITE_DEV_WALLET_KEY }
      : null;
  if (devWallet && network === "mainnet") {
    throw new Error("The dev wallet cannot be used on mainnet");
  }
  return {
    network: env.VITE_NEAR_RPC_URL
      ? {
          rpcUrl: env.VITE_NEAR_RPC_URL,
          networkId: network === "sandbox" ? "localnet" : network,
        }
      : (network as "testnet" | "mainnet"),
    contractId,
    keeperUrl: (env.VITE_KEEPER_URL ?? "http://localhost:8787").replace(/\/+$/, ""),
    devWallet,
  };
}
