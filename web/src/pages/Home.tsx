import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { KatBadge } from "../components/KatBadge.tsx";
import { MintPanel } from "../components/MintPanel.tsx";
import { Shell } from "../components/Shell.tsx";
import { describeProblem } from "../lib/problems.ts";
import { useAsync } from "../lib/useAsync.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

export function Home() {
  const wallet = useWallet();
  const { contract, signer, prices } = useServices();
  const navigate = useNavigate();
  const [config] = useAsync("config", () => contract.getConfig());
  const [kats, reloadKats] = useAsync(wallet.accountId, () =>
    contract.katsOf(wallet.accountId as string),
  );
  const [minted, setMinted] = useState(false);

  async function mint(mintPrice: bigint, startingBalance: bigint) {
    if (!signer) {
      return;
    }
    // The id comes from the mint itself, so a slow or failed follow-up read
    // can never make a successful mint look like a failed one.
    const tokenId = await signer.mint(mintPrice, startingBalance);
    void reloadKats();
    if (tokenId) {
      navigate(`/kat/${tokenId}`);
    } else {
      // Some wallets do not hand the result back. The mint still happened.
      setMinted(true);
    }
  }

  return (
    <Shell world="surface">
      <div className="grid gap-12 pt-10 lg:grid-cols-[1.25fr_1fr] lg:items-start lg:pt-20">
        <div>
          <h1 className="text-[2.6rem] leading-[1.02] sm:text-7xl">
            Raise a kat.
            <br />
            Give it away.
            <br />
            It remembers.
          </h1>
          <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-mist">
            Every nearkat is an NFT with a mind of its own. Shape its personality, talk to it, and
            when you hand it to someone else, its memories go with it. Only the kat's owner can read
            its mind.
          </p>
        </div>
        {config.status === "ready" ? (
          <div>
            <MintPanel
              mintPrice={BigInt(config.data.mint_price)}
              chatPrice={prices.chat}
              onMint={signer ? (balance) => mint(BigInt(config.data.mint_price), balance) : null}
              onConnect={wallet.connect}
            />
            {minted && (
              <p className="mt-3 text-sm text-glow" role="status">
                Minted. Your new kat is under "Your mob" below.
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-cream/15 bg-dusk/80 p-6 text-mist" role="status">
            {config.status === "loading"
              ? "Reading the contract…"
              : `Can't read the contract. ${describeProblem(config.error)}`}
          </p>
        )}
      </div>

      {wallet.status === "connected" && (
        <section className="mt-20" aria-labelledby="mob">
          <h2 id="mob" className="text-3xl">
            Your mob
          </h2>
          {kats.status === "loading" && <p className="mt-4 text-mist">Looking for your kats…</p>}
          {kats.status === "error" && (
            <p className="mt-4 text-alarm" role="alert">
              Can't list your kats. {describeProblem(kats.error)}
            </p>
          )}
          {kats.status === "ready" && kats.data.length === 0 && (
            <p className="mt-4 text-mist">No kats in this wallet yet. Mint your first one above.</p>
          )}
          {kats.status === "ready" && kats.data.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-6">
              {kats.data.map((id) => (
                <li key={id}>
                  <Link to={`/kat/${id}`} className="group flex items-center gap-3">
                    <KatBadge tokenId={id} decorative />
                    <span className="font-bold group-hover:text-glow">Nearkat #{id}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Shell>
  );
}
