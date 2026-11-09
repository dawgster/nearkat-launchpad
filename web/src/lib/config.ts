export interface AppConfig {
  networkId: "testnet" | "mainnet" | "sandbox";
  /** A custom RPC endpoint. Null means the network's default. */
  rpcUrl: string | null;
  contractId: string;
  keeperUrl: string;
  /** The recipient the keeper's sign-in message must name. Anything else is not signed. */
  authRecipient: string;
  /** The launchpad contract. Null hides the launchpad. */
  factoryId: string | null;
  /** Development only: sign with this key instead of a browser wallet. */
  devWallet: { accountId: string; privateKey: string } | null;
  /**
   * Training apps by app id: base URL, and the recipient their sign-in
   * message must name (each its own, never the keeper's). An app missing
   * here can't be trained with from this app.
   */
  trainers: Record<string, TrainerConfig>;
}

export interface TrainerConfig {
  url: string;
  recipient: string;
}

/** What a trainer in local mode signs renters in as, when no recipient is given. */
export const LOCAL_TRAINER_RECIPIENT = "trainer.local";

type Env = Record<string, string | undefined>;

/**
 * `VITE_TRAINER_URLS`: a JSON object of app id to either a URL (a local
 * trainer, signing in as trainer.local) or `{ url, recipient }`.
 */
function trainers(
  value: string | undefined,
  keeperRecipient: string,
): Record<string, TrainerConfig> {
  if (!value) {
    return {};
  }
  const problem = "VITE_TRAINER_URLS must be a JSON object of app id to URL or { url, recipient }";
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(problem);
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(
      ([id, entry]): [string, TrainerConfig] => {
        const given =
          typeof entry === "string"
            ? { url: entry, recipient: LOCAL_TRAINER_RECIPIENT }
            : (entry as Partial<TrainerConfig> | null);
        if (
          !given ||
          typeof given.url !== "string" ||
          !given.url ||
          typeof given.recipient !== "string" ||
          !given.recipient
        ) {
          throw new Error(problem);
        }
        if (given.recipient === keeperRecipient) {
          throw new Error(
            `VITE_TRAINER_URLS: training app ${id} needs its own sign-in recipient, not the keeper's`,
          );
        }
        return [id, { url: given.url.replace(/\/+$/, ""), recipient: given.recipient }];
      },
    ),
  );
}

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
  const authRecipient = env.VITE_AUTH_RECIPIENT ?? "nearkat.xyz";
  return {
    networkId,
    rpcUrl: env.VITE_NEAR_RPC_URL || null,
    contractId,
    keeperUrl: (env.VITE_KEEPER_URL ?? "http://localhost:8787").replace(/\/+$/, ""),
    authRecipient,
    factoryId: env.VITE_FACTORY_ID || null,
    devWallet,
    trainers: trainers(env.VITE_TRAINER_URLS, authRecipient),
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
