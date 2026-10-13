import type { Near } from "near-kit";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { forgetSessions, type SignMessage } from "../lib/session.ts";
import type { WalletBackend } from "./backend.ts";

export interface WalletState {
  /** "restoring" until we know whether a wallet was already connected. */
  status: "restoring" | "disconnected" | "connected";
  accountId: string | null;
  /** Sends transactions as the connected account. Null while disconnected. */
  near: Near | null;
  /** Signs the keeper's sign-in message. Null while disconnected. */
  signMessage: SignMessage | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({
  backend,
  children,
}: {
  backend: WalletBackend;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<WalletState["status"]>("restoring");
  const [accountId, setAccountId] = useState<string | null>(null);

  const show = useCallback((account: string | null) => {
    setAccountId((before) => {
      // Sessions and proofs belong to the account that made them.
      if (before !== null && before !== account) {
        forgetSessions();
      }
      return account;
    });
    setStatus(account ? "connected" : "disconnected");
  }, []);

  useEffect(() => {
    let current = true;
    backend.restore().then((restored) => current && show(restored));
    // The wallet can switch account or sign out on its own; follow it.
    const unsubscribe = backend.onAccountChange((account) => current && show(account));
    return () => {
      current = false;
      unsubscribe();
    };
  }, [backend, show]);

  const connect = useCallback(async () => show(await backend.connect()), [backend, show]);

  const disconnect = useCallback(async () => {
    try {
      await backend.disconnect();
    } finally {
      forgetSessions();
      show(null);
    }
  }, [backend, show]);

  const connected = status === "connected";
  return (
    <WalletContext.Provider
      value={{
        status,
        accountId,
        near: connected ? backend.near() : null,
        signMessage: connected ? backend.signMessage : null,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const wallet = useContext(WalletContext);
  if (!wallet) {
    throw new Error("useWallet must be used inside a WalletProvider");
  }
  return wallet;
}
