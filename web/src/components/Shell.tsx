import { type ReactNode, useState } from "react";
import { Link, NavLink } from "react-router";
import type { DayPhase } from "../lib/dayPhase.ts";
import { shorten } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import { useServices } from "../services.tsx";
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
      <div className="flex min-w-0 items-center gap-2">
        <span className="chip min-w-0 font-mono" title={wallet.accountId}>
          <span className="size-2 shrink-0 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
          <span className="truncate">{shorten(wallet.accountId, 8)}</span>
        </span>
        <button
          type="button"
          className="button button-quiet button-sm shrink-0"
          onClick={() => void wallet.disconnect().catch(() => undefined)}
        >
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

/** The burrow's mark: a kat on sentry, its eye catching the light. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="var(--accent)" fillOpacity="0.14" />
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--accent)" strokeOpacity="0.45" />
      <g fill="var(--color-cream)">
        <path d="M12.6 26c-1-4.6-.4-9 1.3-12 .6-1 3.6-1 4.2 0 1.7 3 2.3 7.4 1.3 12Z" />
        <circle cx="16" cy="10.6" r="3.6" />
        <circle cx="13.6" cy="7.9" r="1.1" />
        <circle cx="18.4" cy="7.9" r="1.1" />
      </g>
      <circle cx="14.7" cy="10.4" r="0.8" fill="var(--color-night)" />
    </svg>
  );
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1.5 text-sm transition-colors ${
    isActive ? "bg-cream/10 text-cream" : "text-mist hover:text-cream"
  }`;

/**
 * The frame around every page. `world` picks the backdrop: the night surface,
 * the burrow, or the painted savannah, which brings its own `scene` and
 * follows the local time through `phase`.
 */
export function Shell({
  world,
  scene,
  phase,
  children,
}: {
  world: "surface" | "burrow" | "savannah";
  scene?: ReactNode;
  phase?: DayPhase;
  children: ReactNode;
}) {
  const { launchpad } = useServices();
  return (
    <div
      className={`${world} relative isolate flex min-h-dvh flex-col overflow-x-clip`}
      data-day-phase={phase}
    >
      {world === "surface" && <Horizon />}
      {scene}
      <div className="shell-bar">
        <header className="relative mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-5 sm:py-5">
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link
              to="/"
              className="flex items-center gap-2.5 font-display text-lg text-cream sm:text-xl"
            >
              <Mark />
              Nearkat burrow
            </Link>
            {launchpad && (
              <NavLink to="/launch" className={navLink}>
                Launchpad
              </NavLink>
            )}
          </nav>
          <WalletButton />
        </header>
      </div>
      <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-5 sm:pb-24">
        {children}
      </main>
      <footer className="relative mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-mist/80 sm:px-5">
        Minds on NEAR · context keys from NEAR's MPC network · stored with FastFS
      </footer>
    </div>
  );
}
