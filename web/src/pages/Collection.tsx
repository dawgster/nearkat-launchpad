import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Icon, type IconName } from "../components/Icon.tsx";
import { ListSamplesPanel, ListSamplesUnavailable } from "../components/ListSamplesPanel.tsx";
import { MintPanel } from "../components/MintPanel.tsx";
import { RentPanel } from "../components/RentPanel.tsx";
import { Shell } from "../components/Shell.tsx";
import { TokenArt } from "../components/TokenArt.tsx";
import { RentalsUnavailable, TrainPanel } from "../components/TrainPanel.tsx";
import { PLAIN_STAGE_NAMES, STAGE_NAMES, stageOf } from "../lib/art.ts";
import { isModelToken, KatContract, MODEL_PREFIX } from "../lib/contract.ts";
import { formatNear, shorten } from "../lib/format.ts";
import {
  type Terms as CollectionTerms,
  type CollectionView,
  pricesFor,
  type TeeRequirement,
} from "../lib/launchpad.ts";
import { describeProblem } from "../lib/problems.ts";
import { useAsync } from "../lib/useAsync.ts";
import { ViewCache } from "../lib/viewCache.ts";
import { useServices } from "../services.tsx";
import { useTrainers } from "../trainers.ts";
import { useWallet } from "../wallet/WalletProvider.tsx";

function Privacy({ tee }: { tee: TeeRequirement | null }) {
  if (tee) {
    return (
      <p className="text-sm leading-relaxed">
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
    <p className="text-sm leading-relaxed text-mist">
      Any keeper the creator names. Owners are the only ones who can read their token's context
      through the app; whether the keeper's operator can too depends on where the keeper runs.
    </p>
  );
}

/** One figure about the collection, with a bar when it fills toward a limit. */
function Stat({ label, value, share }: { label: string; value: string; share?: number }) {
  return (
    <div className="card !p-4">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1.5 truncate font-display text-xl tracking-tight sm:text-2xl">{value}</dd>
      {share !== undefined && (
        <div className="meter mt-2.5" aria-hidden="true">
          <span style={{ width: `${Math.min(share * 100, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** One line of the privacy summary, with its icon. */
function Point({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-glow/10 text-glow ring-1 ring-glow/25">
        <Icon name={icon} size={16} />
      </span>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

/** A collection launched on the launchpad, or the home collection seen the same way. */
export function Collection() {
  const { contractId = "" } = useParams();
  const { config, prices, reader: near } = useServices();
  const wallet = useWallet();
  const home = contractId === config.contractId;
  // One limiter and cache for the page's views: a dataset's scans read each
  // token once, at most 8 calls at a time. Cleared before every reload.
  const reader = useMemo(
    () => new KatContract(near, contractId, { views: new ViewCache(8) }),
    [near, contractId],
  );
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
  const dataset = typeof c.kind === "object" && "Dataset" in c.kind ? c.kind.Dataset : null;
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
    reader.forget();
    void reloadTokens();
    void reloadCollection();
  }

  return (
    <Shell world="surface">
      <div className="flex flex-col gap-6 pt-8 sm:flex-row sm:items-center sm:gap-8 sm:pt-12">
        <div className="relative w-fit shrink-0">
          <div
            className="absolute -inset-8 rounded-full bg-[radial-gradient(closest-side,#19f6a133,transparent)]"
            aria-hidden="true"
          />
          <div className="relative">
            <TokenArt
              contractId={contractId}
              tokenId="1"
              contextVersion={4}
              style={style}
              size={128}
              decorative
            />
          </div>
        </div>
        <div className="min-w-0">
          <h1 className="text-4xl sm:text-6xl">{c.name}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-mist">
            <span className="chip font-mono">{c.symbol}</span>
            <span className="chip text-mist">
              by{" "}
              <span className="font-mono text-cream" title={s.admin_id}>
                {shorten(s.admin_id, 12)}
              </span>
            </span>
            {c.tee && (
              <span className="chip chip-accent">
                <Icon name="lock" size={14} />
                TEE only
              </span>
            )}
          </p>
        </div>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Mint price" value={`${formatNear(s.mint_price)} NEAR`} />
        <Stat
          label="Minted"
          value={`${c.minted}${c.max_supply !== null ? ` of ${c.max_supply}` : ""}`}
          share={c.max_supply ? Number(c.minted) / Number(c.max_supply) : undefined}
        />
        <Stat label="Royalty" value={`${c.terms.royalty_bps / 100}%`} />
        <Stat
          label="Per message"
          value={`${formatNear(home ? prices.chat : pricesFor(c.terms, prices).chat, 6)} NEAR`}
        />
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-5">
          <div className="card space-y-6">
            <section aria-labelledby="prompt">
              <h2 id="prompt" className="card-title">
                The prompt every token shares
              </h2>
              <p className="mt-3 whitespace-pre-wrap rounded-xl bg-black/35 p-4 text-sm leading-relaxed ring-1 ring-cream/8">
                {c.prompt}
              </p>
            </section>
            <section aria-labelledby="starter">
              <h2 id="starter" className="eyebrow">
                Where each token starts
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{c.starter}</p>
              <p className="mt-2 text-sm text-mist">
                From here it changes only through conversations with its owner.
              </p>
            </section>
          </div>
          <section className="card" aria-labelledby="privacy">
            <h2 id="privacy" className="card-title">
              Who can open the tokens' minds
            </h2>
            <ul className="mt-4 space-y-4">
              <Point icon="lock">
                <Privacy tee={c.tee} />
              </Point>
              {c.key_source ? (
                <Point icon="key">
                  <p className="text-sm leading-relaxed text-mist">
                    <span className="font-bold text-cream">Keys from NEAR's MPC network.</span> Each
                    token's key derives from a key the network (
                    <span className="font-mono">{c.key_source.mpc_contract_id}</span>, domain{" "}
                    {c.key_source.domain_id}) makes for this collection's account alone, and hands
                    only to the keeper this contract names. No keeper holds a key of its own that
                    could open them, and a new keeper can take over without anything being handed
                    across.
                  </p>
                </Point>
              ) : (
                <Point icon="key">
                  <p className="text-sm leading-relaxed text-mist">
                    Keys come from the keeper's own secret.
                  </p>
                </Point>
              )}
              {c.wallet_code_hash != null && (
                <Point icon="wallet">
                  <p className="text-sm leading-relaxed text-mist">
                    <span className="font-bold text-cream">
                      Every token can have its own wallet
                    </span>
                    : a NEAR account with no keys, which only this contract can send from. Its owner
                    can always send from it; the token itself only within what its owner allows. It
                    goes with the token the moment it changes hands.
                  </p>
                </Point>
              )}
              {c.history_import && (
                <Point icon="download">
                  <p className="text-sm leading-relaxed text-mist">
                    <span className="font-bold text-cream">
                      Owners can teach their token their chat history
                    </span>
                    : a ChatGPT or Claude export, trimmed to their own messages and sealed in their
                    browser to the keeper. The token keeps only what it learns.
                  </p>
                </Point>
              )}
              {c.sealed_prompt && (
                <Point icon="shield">
                  <p className="text-sm leading-relaxed text-mist">
                    <span className="font-bold text-cream">It also has secret instructions</span>,
                    sealed to key{" "}
                    <span className="font-mono">{shorten(c.sealed_prompt.sealed_to, 8)}</span>.{" "}
                    {c.sealed_key_attested
                      ? "The contract has verified that this key lives inside the app."
                      : "The contract hasn't yet verified a keeper holding this key inside the app."}
                  </p>
                </Point>
              )}
            </ul>
          </section>
          <section className="card" aria-labelledby="terms">
            <h2 id="terms" className="card-title">
              Terms
            </h2>
            <Terms terms={c.terms} />
            <p className="hint mt-4">
              {c.base_uri
                ? `Token images are at ${c.base_uri}<number>.${c.media_extension}.`
                : "Token images exist only in this app."}{" "}
              Everything here is fixed at launch.
            </p>
          </section>
          {dataset && (
            <DatasetSection
              contractId={contractId}
              reader={reader}
              classes={dataset.classes}
              classCounts={c.class_counts}
              accountId={wallet.accountId}
            />
          )}
          <KeeperPanel
            contractId={contractId}
            collection={c}
            adminId={s.admin_id}
            keeperId={s.keeper_id}
            onChange={() => {
              reader.forget();
              void reloadCollection();
            }}
          />
          <Version contractId={contractId} collection={c} adminId={s.admin_id} />
        </div>

        <div className="lg:sticky lg:top-5">
          {soldOut ? (
            <p className="card text-mist">All {c.max_supply} have been minted.</p>
          ) : (
            <MintPanel
              mintPrice={BigInt(s.mint_price)}
              chatPrice={home ? prices.chat : pricesFor(c.terms, prices).chat}
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
            <p className="card mt-6 text-mist">None in this wallet yet.</p>
          )}
          {tokens.status === "ready" && tokens.data.length > 0 && (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tokens.data.map(({ id, version }) => {
                // A dataset's models are tokens too, named after their run.
                const isModel = dataset !== null && isModelToken(id);
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
                    <span className="min-w-0">
                      <span className="block break-all font-bold">
                        {isModel ? `Model ${id.slice(MODEL_PREFIX.length)}` : `${c.name} #${id}`}
                      </span>
                      <span className="text-sm text-mist">
                        {isModel
                          ? "Trained model, sealed"
                          : (home ? STAGE_NAMES : PLAIN_STAGE_NAMES)[stageOf(version)]}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={id}>
                    <Link
                      to={home ? `/kat/${id}` : `/c/${contractId}/kat/${id}`}
                      className="card flex items-center gap-4 !p-4 transition-colors hover:border-glow/50"
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
    <p className="mt-4 flex items-start gap-2 px-1 text-sm leading-relaxed text-mist">
      <span
        className={`mt-1.5 size-2 shrink-0 rounded-full ${served ? "bg-glow shadow-[0_0_8px_#19f6a1]" : "bg-lamp"}`}
        aria-hidden="true"
      />
      <span>
        {served
          ? "This app's keeper serves this collection: open one of your tokens to talk to it."
          : waiting
            ? `This app's keeper doesn't serve this collection: ${waiting.reason}.`
            : "This app's keeper hasn't picked this collection up yet. New launches are found within a minute."}{" "}
        Its keeper is <span className="font-mono">{shorten(keeperId, 12)}</span>.
      </span>
    </p>
  );
}

function Terms({ terms }: { terms: CollectionTerms }) {
  const percent = (bps: number) => `${bps / 100}%`;
  const keeperPrice =
    terms.creator_share_bps > 0
      ? "The keeper's price, plus the creator's share"
      : "The keeper's price";
  return (
    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
      <dt className="text-mist">Royalty on resales</dt>
      <dd>{percent(terms.royalty_bps)}, to the creator</dd>
      <dt className="text-mist">Creator's share of conversations</dt>
      <dd>{percent(terms.creator_share_bps)}</dd>
      <dt className="text-mist">Per message</dt>
      <dd>{terms.chat_price ? `${formatNear(terms.chat_price, 6)} NEAR` : keeperPrice}</dd>
      <dt className="text-mist">Per memory save</dt>
      <dd>{terms.save_price ? `${formatNear(terms.save_price, 6)} NEAR` : keeperPrice}</dd>
    </dl>
  );
}

/**
 * Which published code the collection runs, and, for its admin, the newer
 * versions its launchpad has approved. Upgrading keeps every token and its
 * mind; a launchpad only approves versions that keep the collection's promises.
 */
/**
 * Who keeps the tokens' minds, and the admin's controls over it: hand the
 * collection to another keeper, or move to a new key epoch.
 */
function KeeperPanel({
  contractId,
  collection,
  adminId,
  keeperId,
  onChange,
}: {
  contractId: string;
  collection: CollectionView;
  adminId: string;
  keeperId: string;
  onChange: () => void;
}) {
  const wallet = useWallet();
  const [newKeeper, setNewKeeper] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const isAdmin = wallet.accountId === adminId && wallet.near !== null;
  const epoch = collection.key_epoch;

  async function run(action: (contract: KatContract) => Promise<void>, done: string) {
    if (!wallet.near) {
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      await action(new KatContract(wallet.near, contractId));
      setOutcome(done);
      onChange();
    } catch (error) {
      setOutcome(describeProblem(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="keeper">
      <h2 id="keeper" className="card-title">
        Keeper
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-mist">
        Kept by <span className="font-mono text-cream">{keeperId}</span>
        {epoch !== undefined && (
          <>
            , under key epoch <span className="text-cream">{epoch}</span>. The epoch moves on
            whenever the keeper changes, so a keeper that is replaced can't read anything saved
            after it left
          </>
        )}
        .
      </p>
      {isAdmin && (
        <div className="mt-5 space-y-3 rounded-xl bg-black/25 p-4 ring-1 ring-cream/8">
          <p className="eyebrow">Creator controls</p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const id = newKeeper.trim();
              if (id === keeperId) {
                setOutcome(`${id} is already the keeper.`);
              } else if (id) {
                void run(
                  (contract) => contract.setKeeper(id),
                  `Handed to ${id}. Contexts saved from now on use key epoch ${(epoch ?? 1) + 1}.`,
                );
              }
            }}
          >
            <label className="text-sm">
              <span className="block text-mist">Hand the collection to another keeper</span>
              <input
                className="field mt-1 w-64 max-w-full font-mono"
                value={newKeeper}
                onChange={(event) => setNewKeeper(event.target.value)}
                placeholder="keeper account id"
                aria-label="New keeper account"
              />
            </label>
            <button
              type="submit"
              className="button button-quiet"
              disabled={busy || !newKeeper.trim()}
            >
              Change keeper
            </button>
          </form>
          <button
            type="button"
            className="button button-quiet"
            disabled={busy}
            onClick={() =>
              void run(
                (contract) => contract.rotateContextKey(),
                `Moved to key epoch ${(epoch ?? 1) + 1}.`,
              )
            }
          >
            Rotate the key
          </button>
          <p className="text-xs text-mist">
            Rotating protects what is saved next if a context key leaked. The current keeper gets
            the new key too, so if you don't trust the keeper itself, change keeper instead. Old
            contexts stay readable to the current keeper; each token moves to the new key on its
            next save.
          </p>
        </div>
      )}
      {outcome && (
        <p className="mt-2 text-sm" role="status">
          {outcome}
        </p>
      )}
    </section>
  );
}

function Version({
  contractId,
  collection,
  adminId,
}: {
  contractId: string;
  collection: CollectionView;
  adminId: string;
}) {
  const { launchpad } = useServices();
  const wallet = useWallet();
  const fromLaunchpad = launchpad !== null && collection.factory_id === launchpad.id;
  const [approved] = useAsync(fromLaunchpad ? `approved/${contractId}` : null, () =>
    (launchpad as NonNullable<typeof launchpad>).approvedVersions(),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const isAdmin = wallet.accountId === adminId;
  const others =
    approved.status === "ready"
      ? approved.data.filter((hash) => hash !== collection.code_hash)
      : [];

  async function upgrade(codeHash: string) {
    if (!wallet.near) {
      return;
    }
    setBusy(codeHash);
    setOutcome(null);
    try {
      await new KatContract(wallet.near, contractId).upgrade(codeHash);
      setOutcome(`Now running version ${shorten(codeHash, 6)}. Reload to see it.`);
    } catch (error) {
      setOutcome(describeProblem(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-labelledby="version">
      <h2 id="version" className="card-title">
        Version
      </h2>
      <p className="mt-2 text-sm text-mist">
        {collection.code_hash ? (
          <>
            Runs published code{" "}
            <span className="break-all font-mono text-cream">{collection.code_hash}</span>, which
            anyone can compare with the source.
          </>
        ) : (
          "Runs code its operator deployed directly."
        )}
      </p>
      {isAdmin && fromLaunchpad && others.length > 0 && (
        <ul className="mt-3 space-y-2">
          {others.map((hash) => (
            <li key={hash} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-mono">{shorten(hash, 8)}</span>
              <button
                type="button"
                className="button button-quiet"
                disabled={busy !== null}
                onClick={() => void upgrade(hash)}
              >
                {busy === hash ? "Upgrading…" : "Upgrade to this version"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {outcome && (
        <p className="mt-2 text-sm" role="status">
          {outcome}
        </p>
      )}
    </section>
  );
}

/**
 * A dataset collection: what its creator says it holds, the training apps, and
 * renting. Pictures never appear: samples are only ever opened by an app.
 */
function DatasetSection({
  contractId,
  reader,
  classes,
  classCounts,
  accountId,
}: {
  contractId: string;
  reader: KatContract;
  classes: string[];
  classCounts: string[] | undefined;
  accountId: string | null;
}) {
  const wallet = useWallet();
  const { config } = useServices();
  const [apps] = useAsync(`training-apps/${contractId}`, () => reader.trainingApps());
  const [rentals, reloadRentals] = useAsync(
    accountId ? `rentals/${contractId}/${accountId}` : null,
    () => reader.rentalsOf(accountId as string),
  );
  const trainers = useTrainers(accountId);
  const explorer =
    config.networkId === "sandbox"
      ? null
      : `https://${config.networkId === "testnet" ? "testnet." : ""}nearblocks.io/txns/`;
  const [offers, reloadOffers] = useAsync(`offers/${contractId}`, () => reader.sampleOffers());
  const [mine, reloadMine] = useAsync(
    accountId ? `my-samples/${contractId}/${accountId}` : null,
    async () => {
      // The account's samples only: a model it holds is a token too, but can't be rented out.
      const ids = await reader.samplesOf(accountId as string);
      const statuses = await Promise.all(
        ids.map(async (id) => [id, (await reader.getLoan(id))?.status] as const),
      );
      // Rented samples can't be listed; those on offer are listed again only
      // when the holder asks, to change their terms.
      return {
        free: statuses.filter(([, status]) => status !== "active" && status !== "offered"),
        offered: statuses.filter(([, status]) => status === "offered"),
      };
    },
  );
  const [models, reloadModels] = useAsync(`models/${contractId}`, () => reader.getModels());
  const labels = Object.fromEntries(apps.status === "ready" ? apps.data : []);
  const signer = wallet.near && accountId ? new KatContract(wallet.near, contractId) : null;
  const tokenPath = (tokenId: string) => `/c/${contractId}/kat/${tokenId}`;

  return (
    <>
      <section className="card" aria-labelledby="dataset">
        <h2 id="dataset" className="card-title">
          The dataset
        </h2>
        <p className="mt-2 text-xs text-mist">
          Declared by the creator. Nothing on-chain checks the pictures match their class.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {classes.map((name, i) => (
            <li key={name} className="chip">
              {name}
              {classCounts?.[i] !== undefined && (
                <span className="ml-1.5 text-mist">{classCounts[i]}</span>
              )}
            </li>
          ))}
        </ul>
        <h3 className="eyebrow mt-5">Training apps</h3>
        {apps.status === "ready" && apps.data.length === 0 && (
          <p className="mt-2 text-sm text-mist">No training app is registered yet.</p>
        )}
        {apps.status === "ready" && apps.data.length > 0 && (
          <ul className="mt-2 space-y-1.5 text-sm">
            {apps.data.map(([id, label]) => (
              <li key={id} className="break-all">
                {label || "(no label)"} <span className="font-mono text-xs text-mist">({id})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {signer && mine.status === "error" && (
        <ListSamplesUnavailable
          error={mine.error}
          onRetry={() => {
            reader.forget();
            void reloadMine();
          }}
        />
      )}
      {signer && mine.status === "ready" && apps.status === "ready" && (
        <ListSamplesPanel
          available={mine.data.free.map(([id]) => id)}
          offered={mine.data.offered.map(([id]) => id)}
          apps={apps.data}
          list={async (ids, terms) => {
            try {
              return await signer.lendMany(accountId as string, ids, terms);
            } finally {
              // Some batches may have gone through even if a later one failed.
              reader.forget();
              void reloadOffers();
              void reloadMine();
            }
          }}
          withdraw={async (ids) => {
            try {
              return await signer.endLoans(accountId as string, ids);
            } finally {
              reader.forget();
              void reloadOffers();
              void reloadMine();
            }
          }}
        />
      )}
      {signer && offers.status === "ready" && (
        <RentPanel
          offers={offers.data}
          renter={accountId ?? undefined}
          labels={labels}
          borrow={async (ids, appId) => {
            const byId = new Map(offers.data.map((offer) => [offer.tokenId, offer.fee]));
            try {
              return await signer.borrowMany(
                accountId as string,
                ids,
                appId,
                (id) => byId.get(id) ?? 0n,
              );
            } finally {
              reader.forget();
              void reloadOffers();
              void reloadRentals();
            }
          }}
        />
      )}
      {signer && rentals.status === "error" && (
        <RentalsUnavailable
          error={rentals.error}
          onRetry={() => {
            reader.forget();
            void reloadRentals();
          }}
        />
      )}
      {signer && rentals.status === "ready" && (
        <TrainPanel
          contractId={contractId}
          classes={classes}
          rentals={rentals.data}
          labels={labels}
          trainers={trainers}
          getRun={(runId) => reader.getRun(runId)}
          getAppKey={(publicKey) => reader.getAppKey(publicKey)}
          getModel={(tokenId) => reader.getModel(tokenId)}
          tokenPath={tokenPath}
          txUrl={(hash) => (explorer ? `${explorer}${hash}` : null)}
          onFinished={() => {
            reader.forget();
            void reloadRentals();
            void reloadOffers();
            void reloadModels();
          }}
        />
      )}
      <section className="card" aria-labelledby="models">
        <h2 id="models" className="card-title flex items-center gap-2">
          <Icon name="lock" size={18} className="text-mist" />
          Models
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-mist">
          A model trained on these samples is minted to whoever rented them, as a token of this
          collection. What it learned is sealed like the samples: only the training app that made it
          can open it, for the token's owner.
        </p>
        {models.status === "loading" && (
          <p className="mt-3 text-sm text-mist" role="status">
            Reading the models…
          </p>
        )}
        {models.status === "error" && (
          <p className="mt-3 text-sm text-alarm" role="alert">
            Can't read the models right now. {describeProblem(models.error)}
          </p>
        )}
        {models.status === "ready" && models.data.length === 0 && (
          <p className="mt-3 text-sm text-mist">No model has been minted here yet.</p>
        )}
        {models.status === "ready" && models.data.length > 0 && (
          <ul className="mt-3 space-y-3" aria-label="Minted models">
            {models.data.map((model) => (
              <li key={model.token_id}>
                <Link
                  to={tokenPath(model.token_id)}
                  className="block rounded-xl bg-black/25 p-3.5 text-sm ring-1 ring-cream/8 transition-colors hover:ring-glow/50"
                >
                  <span className="block break-all font-bold">Model {model.run_id}</span>
                  <span className="mt-1 block text-mist">
                    {(model.accuracy_bps / 100).toFixed(2)}% held-out accuracy, trained on{" "}
                    {model.token_count} {model.token_count === 1 ? "sample" : "samples"} by{" "}
                    {labels[model.app_id] ? `${labels[model.app_id]} ` : ""}
                    <span className="break-all font-mono text-xs">({model.app_id})</span>
                  </span>
                  <span className="mt-1 block text-xs text-mist">
                    owned by{" "}
                    <span className="font-mono text-cream" title={model.owner_id}>
                      {shorten(model.owner_id, 12)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
