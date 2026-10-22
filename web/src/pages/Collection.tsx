import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { MintPanel } from "../components/MintPanel.tsx";
import { Shell } from "../components/Shell.tsx";
import { TokenArt } from "../components/TokenArt.tsx";
import { PLAIN_STAGE_NAMES, STAGE_NAMES, stageOf } from "../lib/art.ts";
import { KatContract } from "../lib/contract.ts";
import { shorten } from "../lib/format.ts";
import type { TeeRequirement } from "../lib/launchpad.ts";
import { describeProblem } from "../lib/problems.ts";
import { useAsync } from "../lib/useAsync.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

function Privacy({ tee }: { tee: TeeRequirement | null }) {
  if (tee) {
    return (
      <p className="mt-2 text-sm leading-relaxed">
        <span className="font-bold text-glow">Opened only inside a Phala TEE app.</span>{" "}
        <span className="text-mist">
          Contexts are encrypted with keys only Phala app{" "}
          <span className="break-all font-mono text-cream">{tee.Phala.app_id}</span> can get, and a
          keeper running as any other app refuses to serve this collection. Fixed at launch.
        </span>
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm leading-relaxed text-mist">
      Any keeper the creator names. Owners are the only ones who can read their token's context
      through the app; whether the keeper's operator can too depends on where the keeper runs.
    </p>
  );
}

/** A collection launched on the launchpad, or the home collection seen the same way. */
export function Collection() {
  const { contractId = "" } = useParams();
  const { config, prices, reader: near } = useServices();
  const wallet = useWallet();
  const home = contractId === config.contractId;
  const reader = useMemo(() => new KatContract(near, contractId), [near, contractId]);
  const [collection, reloadCollection] = useAsync(`collection/${contractId}`, () =>
    reader.getCollection(),
  );
  const [settings] = useAsync(`config/${contractId}`, () => reader.getConfig());
  const [tokens, reloadTokens] = useAsync(
    wallet.accountId ? `${contractId}/${wallet.accountId}` : null,
    () => reader.tokensWithGrowthOf(wallet.accountId as string),
  );
  const [minted, setMinted] = useState<string | null>(null);

  if (collection.status !== "ready" || settings.status !== "ready") {
    const error =
      collection.status === "error"
        ? collection.error
        : settings.status === "error"
          ? settings.error
          : null;
    return (
      <Shell world="surface">
        <p
          className={`pt-16 ${error ? "text-alarm" : "text-mist"}`}
          role={error ? "alert" : "status"}
        >
          {error
            ? `Can't read this collection. ${describeProblem(error)}`
            : "Reading the collection…"}
        </p>
      </Shell>
    );
  }
  const c = collection.data;
  const s = settings.data;
  const style = home ? "kat" : "sigil";
  const soldOut = c.max_supply !== null && BigInt(c.minted) >= BigInt(c.max_supply);

  async function mint(startingBalance: bigint) {
    if (!wallet.near) {
      return;
    }
    const tokenId = await new KatContract(wallet.near, contractId).mint(
      BigInt(s.mint_price),
      startingBalance,
    );
    setMinted(tokenId ?? "");
    void reloadTokens();
    void reloadCollection();
  }

  return (
    <Shell world="surface">
      <div className="grid gap-12 pt-10 lg:grid-cols-[1.3fr_1fr] lg:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-5">
            <TokenArt
              contractId={contractId}
              tokenId="1"
              contextVersion={4}
              style={style}
              size={104}
              decorative
            />
            <div className="min-w-0">
              <h1 className="text-4xl sm:text-5xl">{c.name}</h1>
              <p className="mt-2 text-sm text-mist">
                {c.symbol} · by{" "}
                <span className="font-mono text-cream" title={s.admin_id}>
                  {shorten(s.admin_id, 12)}
                </span>{" "}
                · {c.minted} minted{c.max_supply !== null && ` of ${c.max_supply}`}
              </p>
            </div>
          </div>

          <section className="mt-10" aria-labelledby="prompt">
            <h2 id="prompt" className="font-sans text-lg font-bold">
              The prompt every token shares
            </h2>
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-black/30 p-4 text-sm leading-relaxed">
              {c.prompt}
            </p>
          </section>
          <section className="mt-8" aria-labelledby="starter">
            <h2 id="starter" className="font-sans text-lg font-bold">
              Where each token starts
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{c.starter}</p>
            <p className="mt-2 text-sm text-mist">
              From here it changes only through conversations with its owner.
            </p>
          </section>
          <section className="mt-8" aria-labelledby="privacy">
            <h2 id="privacy" className="font-sans text-lg font-bold">
              Who can open the tokens' minds
            </h2>
            <Privacy tee={c.tee} />
          </section>
        </div>

        <div>
          {soldOut ? (
            <p className="rounded-xl border border-cream/15 bg-dusk/80 p-6 text-mist">
              All {c.max_supply} have been minted.
            </p>
          ) : (
            <MintPanel
              mintPrice={BigInt(s.mint_price)}
              chatPrice={prices.chat}
              noun={home ? "kat" : "token"}
              onMint={wallet.near ? mint : null}
              onConnect={wallet.connect}
            />
          )}
          {minted !== null && (
            <p className="mt-3 text-sm text-glow" role="status">
              {minted ? `Minted ${c.name} #${minted}.` : "Minted."} It's listed under "Yours" below.
            </p>
          )}
          {!home && <KeeperNote contractId={contractId} keeperId={s.keeper_id} />}
        </div>
      </div>

      {wallet.status === "connected" && (
        <section className="mt-16" aria-labelledby="yours">
          <h2 id="yours" className="text-3xl">
            Yours
          </h2>
          {tokens.status === "ready" && tokens.data.length === 0 && (
            <p className="mt-4 text-mist">None in this wallet yet.</p>
          )}
          {tokens.status === "ready" && tokens.data.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-6">
              {tokens.data.map(({ id, version }) => {
                const art = (
                  <>
                    <TokenArt
                      contractId={contractId}
                      tokenId={id}
                      contextVersion={version}
                      style={style}
                      size={72}
                      decorative
                    />
                    <span>
                      <span className="block font-bold">
                        {c.name} #{id}
                      </span>
                      <span className="text-sm text-mist">
                        {(home ? STAGE_NAMES : PLAIN_STAGE_NAMES)[stageOf(version)]}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={id}>
                    <Link
                      to={home ? `/kat/${id}` : `/c/${contractId}/kat/${id}`}
                      className="flex items-center gap-3 hover:text-glow"
                    >
                      {art}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </Shell>
  );
}

/**
 * Whether this app's keeper serves the collection, so its tokens can be
 * talked to here. A new launch is picked up within about half a minute.
 */
function KeeperNote({ contractId, keeperId }: { contractId: string; keeperId: string }) {
  const { keeper } = useServices();
  const [collections, reload] = useAsync(`keeper-collections/${contractId}`, () =>
    keeper.collections(),
  );
  const data = collections.status === "ready" ? collections.data : null;
  const served = data?.served?.some((entry) => entry.contract_id === contractId) ?? false;
  const waiting = data?.waiting?.find((entry) => entry.contract_id === contractId);
  const undecided = data !== null && !served && !waiting;
  // Ask again until the keeper has looked at this collection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new answer schedules the next ask.
  useEffect(() => {
    if (!undecided) {
      return;
    }
    const timer = setTimeout(() => void reload(), 5000);
    return () => clearTimeout(timer);
  }, [undecided, reload, data]);
  if (!data) {
    return null;
  }
  return (
    <p className="mt-4 text-sm leading-relaxed text-mist">
      {served
        ? "This app's keeper serves this collection: open one of your tokens to talk to it."
        : waiting
          ? `This app's keeper doesn't serve this collection: ${waiting.reason}.`
          : "This app's keeper hasn't picked this collection up yet. New launches are found within a minute."}{" "}
      Its keeper is <span className="font-mono">{shorten(keeperId, 12)}</span>.
    </p>
  );
}
