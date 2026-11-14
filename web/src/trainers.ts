import { useMemo } from "react";
import { KeeperSession } from "./lib/session.ts";
import { createTrainer, type TrainerAccess } from "./lib/trainer.ts";
import { SIGN_IN_MESSAGE, useServices } from "./services.tsx";
import { useWallet } from "./wallet/WalletProvider.tsx";

/**
 * The training apps this deployment knows the address of, by app id, each
 * with the account's sign-in to it: one message for the wallet per app, kept
 * for the tab apart from the keeper's. Empty while no wallet is connected.
 */
export function useTrainers(accountId: string | null): Record<string, TrainerAccess> {
  const { config } = useServices();
  const { signMessage } = useWallet();
  return useMemo(() => {
    if (!accountId || !signMessage) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(config.trainers).map(
        ([appId, { url, recipient }]): [string, TrainerAccess] => {
          const trainer = createTrainer(url);
          const session = new KeeperSession({
            keeper: trainer,
            accountId,
            signMessage,
            // Each training app signs renters in under its own recipient, so a
            // sign-in for one service never opens a session with another.
            expect: { message: SIGN_IN_MESSAGE, recipient },
            callbackUrl: window.location.origin,
            scope: `trainer.${appId}`,
          });
          return [appId, { trainer, session }];
        },
      ),
    );
  }, [config, accountId, signMessage]);
}
