import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { shorten } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import { useWallet } from "../wallet/WalletProvider.tsx";
import { Horizon } from "./Horizon.tsx";

function WalletButton() {
  const wallet = useWallet();
  const [problem, setProblem] = useState<string | null>(null);
  if (wallet.status === "restoring") {
    return <span className="text-sm text-mist">Checking wallet</span>;
  }
  if (wallet.status === "connected" && wallet.accountId) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-cream" title={wallet.accountId}>
          {shorten(wallet.accountId, 10)}
        </span>
        <button type="button" className="button button-quiet" onClick={() => wallet.disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {problem && (
        <span role="alert" className="max-w-xs text-right text-sm text-alarm">
          {problem}
        </span>
      )}
      <button
        type="button"
        className="button"
        onClick={() => {
          setProblem(null);
          wallet.connect().catch((error) => setProblem(describeProblem(error)));
        }}
      >
        Connect wallet
      </button>
    </div>
  );
}

/** The frame around every page. `world` picks the surface or the burrow backdrop. */
export function Shell({ world, children }: { world: "surface" | "burrow"; children: ReactNode }) {
  return (
    <div className={`${world} relative isolate min-h-dvh overflow-hidden`}>
      {world === "surface" && <Horizon />}
      <header className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
        <Link to="/" className="font-display text-xl text-cream">
          Nearkat burrow
        </Link>
        <WalletButton />
      </header>
      <main className="relative mx-auto max-w-6xl px-5 pb-24">{children}</main>
    </div>
  );
}
