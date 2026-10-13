import type { Near } from "near-kit";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { WalletBackend } from "./backend.ts";

export interface WalletState {
  /** "restoring" until we know whether a wallet was already connected. */
  status: "restoring" | "disconnected" | "connected";
  accountId: string | null;
  /** Signs as the connected account. Null while disconnected. */
  near: Near | null;
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

  useEffect(() => {
    let current = true;
    backend.restore().then((restored) => {
      if (current) {
        setAccountId(restored);
        setStatus(restored ? "connected" : "disconnected");
      }
    });
    return () => {
      current = false;
    };
  }, [backend]);

  const connect = useCallback(async () => {
    setAccountId(await backend.connect());
    setStatus("connected");
  }, [backend]);

  const disconnect = useCallback(async () => {
    await backend.disconnect();
    setAccountId(null);
    setStatus("disconnected");
  }, [backend]);

  const near = status === "connected" ? backend.near() : null;
  return (
    <WalletContext.Provider value={{ status, accountId, near, connect, disconnect }}>
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
