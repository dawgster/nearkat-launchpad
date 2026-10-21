import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { KatPortrait } from "../components/KatPortrait.tsx";
import { MintPanel } from "../components/MintPanel.tsx";
import { Shell } from "../components/Shell.tsx";
import { TokenArt } from "../components/TokenArt.tsx";
import { STAGE_NAMES, stageOf } from "../lib/art.ts";
import { formatNear } from "../lib/format.ts";
import { describeProblem } from "../lib/problems.ts";
import { useAsync } from "../lib/useAsync.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

export function Home() {
  const wallet = useWallet();
  const { config: app, contract, signer, prices } = useServices();
  const navigate = useNavigate();
  const [config] = useAsync("config", () => contract.getConfig());
  const [kats, reloadKats] = useAsync(wallet.accountId, () =>
    contract.tokensWithGrowthOf(wallet.accountId as string),
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
            Every nearkat is an NFT with a mind of its own. Talk to it and it grows into someone,
            and when you hand it to someone else, its memories go with it. Only the kat's owner can
            read its mind.
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

      <HowItWorks chatPrice={prices.chat} />

      {app.factoryId && (
        <section className="mt-16 rounded-xl border border-glow/25 bg-dusk/70 p-6 sm:flex sm:items-center sm:justify-between sm:gap-8">
          <div>
            <h2 className="text-2xl">Make your own</h2>
            <p className="mt-2 max-w-prose text-mist">
              Kats are one collection. On the launchpad, anyone can launch NFTs built on their own
              prompt: a tutor, a game master, a character, anything that grows by being talked to.
            </p>
          </div>
          <Link to="/launch" className="button mt-4 shrink-0 sm:mt-0">
            Open the launchpad
          </Link>
        </section>
      )}

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
              {kats.data.map(({ id, version }) => (
                <li key={id}>
                  <Link to={`/kat/${id}`} className="group flex items-center gap-3">
                    <TokenArt
                      contractId={app.contractId}
                      tokenId={id}
                      contextVersion={version}
                      style="kat"
                      size={72}
                      decorative
                    />
                    <span>
                      <span className="block font-bold group-hover:text-glow">Nearkat #{id}</span>
                      <span className="text-sm text-mist">{STAGE_NAMES[stageOf(version)]}</span>
                    </span>
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

const STEPS = [
  {
    title: "Mint",
    text: "Your kat hatches in its burrow with a starter character that anyone can read on-chain.",
  },
  {
    title: "Talk",
    text: "A model in NEAR AI's enclave answers each message and signs the reply. Messages are paid from the kat's own balance.",
  },
  {
    title: "It grows",
    text: "After longer conversations it writes down what mattered. Its character shifts, and it climbs out of its burrow.",
  },
  {
    title: "Give it away",
    text: "Transfer the NFT and its memories go with it. From then on, only the new owner can read them.",
  },
] as const;

/** The four steps, drawn with one kat growing up across them. */
function HowItWorks({ chatPrice }: { chatPrice: bigint }) {
  return (
    <section className="mt-24" aria-labelledby="how">
      <h2 id="how" className="text-3xl">
        How it works
      </h2>
      <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-4 lg:block">
            <KatPortrait
              seed="nearkat-guide"
              stage={index as 0 | 1 | 2 | 3}
              size={88}
              label={`${STAGE_NAMES[index]} kat`}
            />
            <div className="lg:mt-4">
              <h3 className="font-bold">
                <span className="text-lamp">{index + 1}.</span> {step.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-mist">
                {step.title === "Talk"
                  ? `${step.text} Each costs ${formatNear(chatPrice)} NEAR.`
                  : step.text}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
