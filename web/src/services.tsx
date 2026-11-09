import { Near } from "near-kit";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { type AppConfig, nearNetwork } from "./lib/config.ts";
import { KatContract } from "./lib/contract.ts";
import { createKeeper, type Keeper } from "./lib/keeper.ts";
import { Launchpad } from "./lib/launchpad.ts";
import { KeeperSession } from "./lib/session.ts";
import { useWallet } from "./wallet/WalletProvider.tsx";

/** The only sign-in message this app will ask a wallet to sign. */
export const SIGN_IN_MESSAGE = "Sign in to Nearkat";

export interface Prices {
  /** yoctoNEAR per chat message. */
  chat: bigint;
  /** yoctoNEAR per saved personality or memory. */
  save: bigint;
}

/** Shown until the keeper reports its own prices. */
const USUAL_PRICES: Prices = { chat: 2n * 10n ** 21n, save: 5n * 10n ** 22n };

export interface Services {
  config: AppConfig;
  /** Reads any contract without a wallet. */
  reader: Near;
  /** The launchpad, read-only. Null when this deployment has none. */
  launchpad: Launchpad | null;
  keeper: Keeper;
  prices: Prices;
  /** Reads the contract without a wallet. */
  contract: KatContract;
  /** Sends transactions as the connected account. Null while disconnected. */
  signer: KatContract | null;
  /** Calls the keeper as the connected account. Null while disconnected. */
  session: KeeperSession | null;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  const { near, accountId, signMessage } = useWallet();
  const base = useMemo(() => {
    const reader = new Near({ network: nearNetwork(config) });
    return {
      config,
      reader,
      launchpad: config.factoryId ? new Launchpad(reader, config.factoryId) : null,
      keeper: createKeeper(config.keeperUrl),
      contract: new KatContract(reader, config.contractId),
    };
  }, [config]);
  const [prices, setPrices] = useState(USUAL_PRICES);
  useEffect(() => {
    let current = true;
    base.keeper.info().then(
      (info) =>
        current && setPrices({ chat: BigInt(info.chat_price), save: BigInt(info.save_price) }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [base]);

  const services = useMemo<Services>(() => {
    if (!near || !accountId || !signMessage) {
      return { ...base, prices, signer: null, session: null };
    }
    return {
      ...base,
      prices,
      signer: new KatContract(near, config.contractId),
      session: new KeeperSession({
        keeper: base.keeper,
        accountId,
        signMessage,
        expect: { message: SIGN_IN_MESSAGE, recipient: config.authRecipient },
        // Web wallets sign over the page they return to; the keeper checks it is ours.
        callbackUrl: window.location.origin,
      }),
    };
  }, [base, prices, near, accountId, signMessage, config]);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error("useServices must be used inside a ServicesProvider");
  }
  return services;
}
