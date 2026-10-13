import { Near } from "near-kit";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { AppConfig } from "./lib/config.ts";
import { KatContract } from "./lib/contract.ts";
import { createKeeper, type Keeper } from "./lib/keeper.ts";
import { KeeperSession } from "./lib/session.ts";
import { useWallet } from "./wallet/WalletProvider.tsx";

export interface Services {
  config: AppConfig;
  keeper: Keeper;
  /** Reads the contract without a wallet. */
  contract: KatContract;
  /** Sends transactions as the connected account. Null while disconnected. */
  signer: KatContract | null;
  /** Calls the keeper as the connected account. Null while disconnected. */
  session: KeeperSession | null;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  const wallet = useWallet();
  const base = useMemo(
    () => ({
      config,
      keeper: createKeeper(config.keeperUrl),
      contract: new KatContract(new Near({ network: config.network }), config.contractId),
    }),
    [config],
  );
  const { near, accountId } = wallet;
  const services = useMemo<Services>(() => {
    if (!near || !accountId) {
      return { ...base, signer: null, session: null };
    }
    return {
      ...base,
      signer: new KatContract(near, config.contractId),
      session: new KeeperSession({
        keeper: base.keeper,
        accountId,
        signMessage: (params) => near.signMessage(params),
      }),
    };
  }, [base, near, accountId, config.contractId]);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error("useServices must be used inside a ServicesProvider");
  }
  return services;
}
