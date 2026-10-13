import { NearConnector } from "@hot-labs/near-connect";
import { fromNearConnect, Near, type PrivateKey } from "near-kit";
import { type AppConfig, nearNetwork } from "../lib/config.ts";
import type { SignedMessage } from "../lib/keeper.ts";
import type { SignMessage } from "../lib/session.ts";
import { WalletError } from "./errors.ts";

/** Where signatures come from: a browser wallet, or a fixed key in tests. */
export interface WalletBackend {
  /** The account of an existing connection, if there is one. */
  restore(): Promise<string | null>;
  /** Asks the user to connect. Resolves with the connected account. */
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  /** A client that sends transactions as the connected account. */
  near(): Near;
  /** Signs the keeper's sign-in message. Rejects with WalletError if the wallet does not. */
  signMessage: SignMessage;
  /** Calls back when the wallet's account changes without the app asking. Returns an unsubscribe. */
  onAccountChange(listener: (accountId: string | null) => void): () => void;
}

/**
 * Wallets left out of the list. MyNearWallet is deprecated, and signs over the
 * page URL in a way its replacement wallets do not.
 */
const EXCLUDED_WALLETS = ["mynearwallet"];

/** Browser wallets through NEAR Connect. */
export function connectorBackend(config: AppConfig): WalletBackend {
  if (config.networkId === "sandbox") {
    throw new Error("Browser wallets need testnet or mainnet; use the dev wallet for a sandbox");
  }
  const network = config.networkId;
  // Only wallets that can sign the keeper's sign-in message are offered.
  const connector = new NearConnector({
    network,
    features: { signMessage: true },
    excludedWallets: EXCLUDED_WALLETS,
  });
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
      try {
        await connector.connect();
      } catch (error) {
        throw new WalletError(error);
      }
      const accountId = await currentAccount();
      if (!accountId) {
        throw new WalletError("The wallet did not share an account");
      }
      return accountId;
    },
    async disconnect() {
      client = null;
      // The wallet's own session may already be gone; the app disconnects either way.
      await connector.disconnect().catch(() => undefined);
    },
    near: () => {
      client ??= new Near({
        network: nearNetwork(config),
        wallet: fromNearConnect(connector),
      });
      return client;
    },
    // Asked of the wallet directly. near-kit's own signMessage hides a
    // declined request behind an unrelated "no key found" error.
    async signMessage(params) {
      try {
        const wallet = await connector.wallet();
        return (await wallet.signMessage(params)) as SignedMessage;
      } catch (error) {
        throw new WalletError(error);
      }
    },
    onAccountChange(listener) {
      const signedIn = (event: { accounts: Array<{ accountId: string }> }) =>
        listener(event.accounts[0]?.accountId ?? null);
      const signedOut = () => listener(null);
      connector.on("wallet:signIn", signedIn);
      connector.on("wallet:signOut", signedOut);
      return () => {
        connector.off("wallet:signIn", signedIn);
        connector.off("wallet:signOut", signedOut);
      };
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
    network: nearNetwork(config),
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
    signMessage: (params) => near.signMessage(params),
    onAccountChange: () => () => undefined,
  };
}
