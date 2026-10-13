import { NearConnector } from "@hot-labs/near-connect";
import { fromNearConnect, Near, type PrivateKey } from "near-kit";
import type { AppConfig } from "../lib/config.ts";

/** Where signatures come from: a browser wallet, or a fixed key in tests. */
export interface WalletBackend {
  /** The account of an existing connection, if there is one. */
  restore(): Promise<string | null>;
  /** Asks the user to connect. Resolves with the connected account. */
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  /** A client that signs as the connected account. */
  near(): Near;
}

/** Browser wallets through NEAR Connect. */
export function connectorBackend(config: AppConfig): WalletBackend {
  if (typeof config.network !== "string") {
    throw new Error("Browser wallets need testnet or mainnet; use the dev wallet for a sandbox");
  }
  const network = config.network;
  // Only wallets that can sign the keeper's sign-in message are offered.
  const connector = new NearConnector({ network, features: { signMessage: true } });
  const currentAccount = async () => {
    const wallet = await connector.wallet();
    const [account] = await wallet.getAccounts();
    return account?.accountId ?? null;
  };
  // One client for the life of a connection, so everything built on it stays stable.
  let client: Near | null = null;
  return {
    restore: () => currentAccount().catch(() => null),
    async connect() {
      await connector.connect();
      const accountId = await currentAccount();
      if (!accountId) {
        throw new Error("The wallet did not share an account");
      }
      return accountId;
    },
    async disconnect() {
      client = null;
      await connector.disconnect();
    },
    near: () => {
      client ??= new Near({ network, wallet: fromNearConnect(connector) });
      return client;
    },
  };
}

/** Signs with a fixed key. For automated tests against a sandbox or testnet. */
export function devBackend(config: AppConfig): WalletBackend {
  const dev = config.devWallet;
  if (!dev) {
    throw new Error("No dev wallet is configured");
  }
  const near = new Near({
    network: config.network,
    privateKey: dev.privateKey as PrivateKey,
    defaultSignerId: dev.accountId,
  });
  // Remembered for the tab, so a reload stays connected like a real wallet would.
  const flag = "nearkat.dev-wallet.connected";
  return {
    restore: async () => (sessionStorage.getItem(flag) ? dev.accountId : null),
    async connect() {
      sessionStorage.setItem(flag, "1");
      return dev.accountId;
    },
    async disconnect() {
      sessionStorage.removeItem(flag);
    },
    near: () => near,
  };
}
