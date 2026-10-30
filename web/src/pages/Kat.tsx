import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CharacterPanel } from "../components/CharacterPanel.tsx";
import { Chat } from "../components/Chat.tsx";
import { FundPanel } from "../components/FundPanel.tsx";
import { GiveAwayPanel } from "../components/GiveAwayPanel.tsx";
import { Growth } from "../components/Growth.tsx";
import { Icon } from "../components/Icon.tsx";
import { ImportPanel, type KeeperPrivacy } from "../components/ImportPanel.tsx";
import { LendPanel } from "../components/LendPanel.tsx";
import { Shell } from "../components/Shell.tsx";
import { TokenArt } from "../components/TokenArt.tsx";
import { WalletPanel } from "../components/WalletPanel.tsx";
import type { KatContract } from "../lib/contract.ts";
import { formatNear, shorten } from "../lib/format.ts";
import { type ChatReply, KeeperError } from "../lib/keeper.ts";
import { capitalized, describeTerms, loanEnd, who } from "../lib/loans.ts";
import { describeProblem } from "../lib/problems.ts";
import { rememberProof } from "../lib/proof.ts";
import { IMPORT_INFO, sealPrompt } from "../lib/sealing.ts";
import { checkPhalaReport, type PhalaReport } from "../lib/tdx.ts";
import { useAsync } from "../lib/useAsync.ts";
import { type TokenWallet, TokenWallets } from "../lib/wallet.ts";
import { proofId, useScope } from "../scope.tsx";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

/** How long to wait for the keeper to catch up with the chain before showing an error. */
const SETTLE_WAIT_MS = 2000;
const SETTLE_WAITS = 30;
/** Keeper answers that mean "not yet" while the contract shows this wallet as owner. */
const SETTLING_CODES = ["waking_up", "not_owner", "not_found", "not_served"];

/** Where the keeper runs, as far as its attestation shows this browser. */
function privacyOf(report: Record<string, unknown>): KeeperPrivacy {
  if (report.mode === "local") {
    return { kind: "local" };
  }
  if (report.mode !== "phala") {
    return { kind: "unknown", reason: "it reported no TEE" };
  }
  const check = checkPhalaReport(report as unknown as PhalaReport);
  if (check.status !== "read") {
    return { kind: "unknown", reason: check.reason };
  }
  if (!check.bindsKey || !check.logMatchesQuote) {
    return { kind: "unknown", reason: "its quote doesn't bind the key it reports" };
  }
  return { kind: "tee", appId: check.appId };
}

/** The owner's side of the page: the conversation, and what the kat has become. */
function Den({
  tokenId,
  ownerId,
  chainBalance,
  recheckOwner,
  onVersion,
}: {
  tokenId: string;
  ownerId: string;
  chainBalance: bigint;
  /** Re-reads the kat from the contract, in case it has changed hands. */
  recheckOwner: () => Promise<void>;
  /** Told the context version each time the mind is read, so the kat can be drawn grown. */
  onVersion: (version: number) => void;
}) {
  const { config, keeper, session, reader } = useServices();
  const wallet = useWallet();
  const scope = useScope();
  const { prices } = scope;
  const wallets = useMemo(
    () => new TokenWallets(reader, scope.contractId),
    [reader, scope.contractId],
  );

  const { contract, signer } = scope;
  const navigate = useNavigate();
  const name = `${scope.name} #${tokenId}`;
  const [context, reloadContext] = useAsync(
    session ? `${scope.contractId}/${ownerId}/${tokenId}` : null,
    () =>
      // Reads go through the session so the wallet is asked to sign in once.
      (session as NonNullable<typeof session>).call((token) =>
        keeper.getContext(token, tokenId, scope.keeperCollection),
      ),
  );
  const [attestation] = useAsync("keeper-attestation", () => keeper.attestation());
  const [loan, reloadLoan] = useAsync(`loan/${scope.contractId}/${tokenId}`, () =>
    contract.getLoan(tokenId),
  );
  // Only where the collection's creator allowed it.
  const [collectionView] = useAsync(`collection/${scope.contractId}`, () =>
    contract.getCollection(),
  );
  const historyImport =
    collectionView.status === "ready" && collectionView.data.history_import === true;
  const privacy: KeeperPrivacy | null =
    attestation.status === "ready"
      ? privacyOf(attestation.data)
      : attestation.status === "error"
        ? { kind: "unknown", reason: describeProblem(attestation.error) }
        : null;
  // The keeper reports the balance after unsettled charges; the chain lags behind it.
  const [balance, setBalance] = useState(chainBalance);
  const [outOfBalance, setOutOfBalance] = useState(false);

  // The contract says this wallet owns the kat. If the keeper disagrees or the
  // kat has no mind yet, the keeper is a few seconds behind the chain (after a
  // transfer or a mint), so wait for it instead of raising an alarm. Each wait
  // also re-reads the contract: if the kat has really changed hands, this
  // component is replaced by the non-owner view at once.
  const behind =
    context.status === "error" &&
    context.error instanceof KeeperError &&
    SETTLING_CODES.includes(context.error.code)
      ? context.error.code
      : null;
  const [waits, setWaits] = useState(0);
  const version = context.status === "ready" ? context.data.version : null;
  // Read once the mind is: by then the token is final on-chain, so its wallet is too.
  const [tokenWallet, reloadWallet] = useAsync(
    version === null ? null : `wallet/${scope.contractId}/${tokenId}`,
    () => wallets.get(tokenId),
  );
  useEffect(() => {
    if (version !== null) {
      onVersion(version);
    }
  }, [version, onVersion]);
  const avatar = (
    <TokenArt
      contractId={scope.contractId}
      tokenId={tokenId}
      contextVersion={version ?? 1}
      style={scope.art}
      size={32}
      decorative
    />
  );
  const settling = behind !== null && waits < SETTLE_WAITS;
  useEffect(() => {
    // Each failed attempt bumps `waits`, which schedules the next one.
    if (behind === null || waits >= SETTLE_WAITS) {
      return;
    }
    const timer = setTimeout(() => {
      setWaits((count) => count + 1);
      void recheckOwner();
      void reloadContext();
    }, SETTLE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [behind, waits, reloadContext, recheckOwner]);

  if (!session || !signer) {
    return null;
  }
  if (settling) {
    return (
      <p className="card mt-8 flex items-center gap-3 text-lamp" role="status">
        <span className="dots flex gap-1" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {behind === "waking_up"
          ? `${name} is waking up. This takes a few seconds.`
          : `The keeper is catching up with the chain. ${name} will be here in a few seconds.`}
      </p>
    );
  }
  if (context.status === "loading") {
    return (
      <p className="card mt-8 flex items-center gap-3 text-mist" role="status">
        <Icon name="key" size={18} className="shrink-0 text-lamp" />
        Opening {name}'s mind. Your wallet may ask you to approve a sign-in message.
      </p>
    );
  }
  if (context.status === "error") {
    return (
      <div className="card mt-8" role="alert">
        <p className="flex items-start gap-2 text-alarm">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          {describeProblem(context.error)}
        </p>
        <button
          type="button"
          className="button button-quiet mt-4"
          onClick={() => {
            setWaits(0);
            void reloadContext();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-6">
      <div className="lg:sticky lg:top-5">
        <Chat
          katName={name}
          avatar={avatar}
          chatPrice={prices.chat}
          send={(message) =>
            session.call((token) => keeper.chat(token, tokenId, message, scope.keeperCollection))
          }
          onReply={(reply) => {
            setBalance(BigInt(reply.balance));
            setOutOfBalance(false);
            rememberProof(ownerId, proofId(scope, tokenId), reply.verification);
            // A long conversation may have just been folded into memory.
            void reloadContext();
            if (reply.payment) {
              void reloadWallet();
            }
          }}
          onOutOfBalance={() => setOutOfBalance(true)}
          starters={context.data.version === 1 ? scope.starters.fresh : scope.starters.later}
        />
      </div>
      <aside className="min-w-0 space-y-5">
        <div className="card space-y-5">
          <p className="card-title flex items-center gap-2">
            <Icon name="sparkle" size={18} className="text-mist" />
            Its mind
          </p>
          <CharacterPanel character={context.data.personality} noun={scope.noun} />
          <div className="divider" />
          <section aria-labelledby="memory">
            <h2 id="memory" className="eyebrow">
              Memory
            </h2>
            <p
              className={`mt-2 whitespace-pre-wrap leading-relaxed ${
                context.data.memory_summary ? "font-medium text-cream" : "text-sm text-mist"
              }`}
            >
              {context.data.memory_summary ||
                `Nothing remembered yet. After a longer conversation, the ${scope.noun} writes down what mattered.`}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-mist">
              Saving what it learned costs {formatNear(prices.save, 6)} NEAR from its balance, after
              about ten exchanges.
            </p>
          </section>
        </div>
        {historyImport && (
          <ImportPanel
            name={name}
            savePrice={prices.save}
            privacy={privacy}
            send={async (history) => {
              const sealKey =
                attestation.status === "ready" ? attestation.data.seal_public_key : undefined;
              if (typeof sealKey !== "string") {
                throw new Error("This keeper has no key to seal your history to.");
              }
              const sealed = await sealPrompt(sealKey, JSON.stringify(history), IMPORT_INFO);
              const result = await session.call((token) =>
                keeper.importHistory(token, tokenId, sealed, scope.keeperCollection),
              );
              setBalance(BigInt(result.balance));
              await reloadContext();
              return result;
            }}
          />
        )}
        {tokenWallet.status === "loading" && (
          <p className="card text-sm text-mist" role="status">
            Reading its wallet…
          </p>
        )}
        {tokenWallet.status === "error" && (
          <p className="card text-sm text-mist" role="status">
            Its wallet can't be read right now. {describeProblem(tokenWallet.error)}
          </p>
        )}
        {tokenWallet.status === "ready" && tokenWallet.data && wallet.near && (
          <WalletPanel
            noun={scope.noun}
            wallet={tokenWallet.data}
            open={async (amount) => {
              await wallets.open(wallet.near as NonNullable<typeof wallet.near>, tokenId, amount);
              await reloadWallet();
            }}
            fund={async (amount) => {
              await (wallet.near as NonNullable<typeof wallet.near>).send(
                (tokenWallet.data as TokenWallet).address,
                `${amount} yocto`,
              );
              await reloadWallet();
            }}
            setRules={async (daily, max) => {
              await wallets.setRules(
                wallet.near as NonNullable<typeof wallet.near>,
                tokenId,
                daily,
                max,
              );
              await reloadWallet();
            }}
            send={async (receiverId, amount) => {
              const hash = await wallets.send(
                wallet.near as NonNullable<typeof wallet.near>,
                tokenId,
                receiverId,
                amount,
              );
              await reloadWallet();
              return hash;
            }}
          />
        )}
        <ExportPanel
          noun={scope.noun}
          download={async () => {
            const mind = await session.call((token) =>
              keeper.exportMind(token, tokenId, scope.keeperCollection),
            );
            saveJson(`${scope.contractId}-${tokenId}-mind.json`, mind);
          }}
        />
        <FundPanel
          noun={scope.noun}
          balance={balance}
          urgent={outOfBalance}
          fund={async (amount) => {
            await signer.fund(tokenId, amount);
            // The keeper only counts the top-up once it is final. Waiting here
            // means the next message is not refused for a balance that has arrived.
            const funded = await contract.getKat(tokenId);
            if (funded) {
              await contract.waitForFinalBalance(tokenId, BigInt(funded.balance));
            }
            setBalance((current) => current + amount);
            setOutOfBalance(false);
          }}
        />
        <LendPanel
          name={name}
          noun={scope.noun}
          network={config.networkId}
          loan={loan.status === "ready" ? loan.data : undefined}
          lend={async (terms) => {
            await signer.lend(tokenId, terms);
            await reloadLoan();
          }}
          end={async () => {
            await signer.endLoan(tokenId);
            await reloadLoan();
          }}
        />
        <GiveAwayPanel
          noun={scope.noun}
          katName={name}
          ownerId={ownerId}
          network={config.networkId}
          accountExists={(accountId) => contract.accountExists(accountId)}
          give={async (receiverId) => {
            await signer.transfer(tokenId, receiverId);
            navigate(scope.backPath);
          }}
        />
      </aside>
    </div>
  );
}

/**
 * Someone who doesn't own the token: they may have borrowed it, or be
 * offered it; otherwise they see that only its owner can talk to it.
 */
function Visitor({ tokenId, version }: { tokenId: string; version: number }) {
  const { keeper, session } = useServices();
  const wallet = useWallet();
  const scope = useScope();
  const { contract, signer } = scope;
  const name = `${scope.name} #${tokenId}`;
  const [loan, reloadLoan] = useAsync(`loan/${scope.contractId}/${tokenId}`, () =>
    contract.getLoan(tokenId),
  );
  const [standing, setStanding] = useState<ChatReply["loan"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const me = wallet.accountId;
  const current = loan.status === "ready" ? loan.data : null;
  const mine = current?.status === "active" && current.borrower_id === me && me !== null;
  const offered =
    current?.status === "offered" && (current.borrower_id === null || current.borrower_id === me);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      await reloadLoan();
    } catch (error) {
      setProblem(describeProblem(error));
    } finally {
      setBusy(false);
    }
  };
  const alert = problem && (
    <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-alarm">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      {problem}
    </p>
  );

  if (loan.status === "loading") {
    return null;
  }
  if (mine && current && session) {
    const left = standing?.messages_left ?? current.messages;
    return (
      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-6">
        <div className="lg:sticky lg:top-5">
          <Chat
            katName={name}
            chatPrice={scope.prices.chat}
            avatar={
              <TokenArt
                contractId={scope.contractId}
                tokenId={tokenId}
                contextVersion={version || 1}
                style={scope.art}
                size={32}
                decorative
              />
            }
            send={(message) =>
              session.call((token) => keeper.chat(token, tokenId, message, scope.keeperCollection))
            }
            onReply={(reply) => setStanding(reply.loan ?? null)}
            onOutOfBalance={() => undefined}
            starters={scope.starters.fresh}
          />
        </div>
        <aside className="min-w-0 space-y-5">
          <section aria-labelledby="borrowed" className="card card-lit">
            <h2 id="borrowed" className="card-title flex items-center gap-2">
              <Icon name="clock" size={18} className="text-[var(--accent)]" />
              Borrowed
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              {who(current.lender_id)} lent you {name}
              {loanEnd(current) ? ` until ${loanEnd(current)}` : ""}.{" "}
              {capitalized(describeTerms(current, scope.noun))}
            </p>
            {left !== null && (
              <p className="mt-3 font-display text-2xl tracking-tight" data-testid="messages-left">
                {left} message{left === 1 ? "" : "s"} left
              </p>
            )}
            <button
              type="button"
              className="button button-quiet mt-4 w-full"
              disabled={busy}
              onClick={() => void act(() => (signer as KatContract).endLoan(tokenId))}
            >
              Give it back
            </button>
            {alert}
          </section>
        </aside>
      </div>
    );
  }
  if (offered && current) {
    const fee = BigInt(current.fee);
    return (
      <section aria-labelledby="offer" className="card card-lit mt-8 max-w-2xl">
        <h2 id="offer" className="card-title flex items-center gap-2">
          <Icon name="clock" size={18} className="text-[var(--accent)]" />
          {fee > 0n ? "For rent" : "On offer"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-mist">
          {who(current.lender_id)} is lending {name} to{" "}
          {current.borrower_id === null ? "anyone" : "you"}: {describeTerms(current, scope.noun)}{" "}
          You talk to it; you can't read its mind, use its wallet or keep it.
        </p>
        {signer ? (
          <button
            type="button"
            className="button mt-4"
            disabled={busy}
            onClick={() => void act(() => signer.borrow(tokenId, fee))}
          >
            {busy
              ? "Borrowing…"
              : fee > 0n
                ? `Rent it for ${formatNear(fee, 6)} NEAR`
                : "Borrow it"}
          </button>
        ) : (
          <p className="mt-4 text-sm text-lamp">Connect your wallet to borrow it.</p>
        )}
        {alert}
      </section>
    );
  }
  return (
    <p className="card mt-8 flex max-w-2xl items-start gap-3 text-mist">
      <Icon name="lock" size={18} className="mt-0.5 shrink-0 text-lamp" />
      {wallet.status === "connected"
        ? `Only its owner, or someone it's lent to, can talk to ${name}. The connected wallet isn't either.`
        : `Only its owner, or someone it's lent to, can talk to ${name}. Connect your wallet.`}
    </p>
  );
}

/** Lets the browser save a JSON document as a file. */
function saveJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The owner's copy of the mind: theirs to keep, checkable against the chain. */
function ExportPanel({ noun, download }: { noun: string; download: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  return (
    <section aria-labelledby="export" className="card">
      <h2 id="export" className="card-title flex items-center gap-2">
        <Icon name="download" size={18} className="text-mist" />
        Keep a copy
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-mist">
        Download this {noun}'s mind with the on-chain record that proves it is the one the contract
        holds. It's yours to keep, whatever happens to this keeper.
      </p>
      <button
        type="button"
        className="button button-quiet mt-4 w-full"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          try {
            await download();
            setState("done");
          } catch (error) {
            setState(describeProblem(error));
          }
        }}
      >
        {state === "busy" ? "Preparing…" : "Download its mind"}
      </button>
      {state === "done" && (
        <p className="mt-2 text-sm text-glow" role="status">
          Downloaded.
        </p>
      )}
      {state !== "idle" && state !== "busy" && state !== "done" && (
        <p className="mt-2 text-sm text-alarm" role="alert">
          {state}
        </p>
      )}
    </section>
  );
}

export function Kat() {
  const { id = "" } = useParams();
  const wallet = useWallet();
  const scope = useScope();
  const { contract } = scope;
  const [kat, reloadKat] = useAsync(`${scope.contractId}/${id}`, () => contract.getKat(id));
  const name = `${scope.name} #${id}`;
  // The keeper may have saved a newer version than the chain view shows yet.
  const [seenVersion, setSeenVersion] = useState(0);
  const onVersion = useCallback((version: number) => {
    setSeenVersion((current) => Math.max(current, version));
  }, []);
  const version =
    kat.status === "ready" && kat.data
      ? Math.max(Number(kat.data.context_version), seenVersion)
      : seenVersion;

  return (
    <Shell world="burrow">
      <div className="descend">
        <Link
          to={scope.backPath}
          className="inline-flex items-center gap-1.5 text-sm text-mist transition-colors hover:text-cream"
        >
          <Icon name="arrowLeft" size={15} />
          {scope.backLabel}
        </Link>
        {kat.status === "loading" && <p className="mt-10 text-mist">Climbing down…</p>}
        {kat.status === "error" && (
          <p className="mt-10 text-alarm" role="alert">
            Can't read this {scope.noun} from the contract. {describeProblem(kat.error)}
          </p>
        )}
        {kat.status === "ready" && !kat.data && (
          <div className="mt-10">
            <h1 className="text-4xl">{scope.home ? "This burrow is empty" : "Nothing here yet"}</h1>
            <p className="mt-3 text-mist">There is no {name}. It may not have been minted yet.</p>
          </div>
        )}
        {kat.status === "ready" && kat.data && (
          <>
            <header className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
              <div className="relative w-fit shrink-0">
                <div
                  className="absolute -inset-6 rounded-full bg-[radial-gradient(closest-side,#f2bd3540,transparent)]"
                  aria-hidden="true"
                />
                <div className="relative rounded-full ring-1 ring-lamp/30 ring-offset-4 ring-offset-transparent">
                  <TokenArt
                    contractId={scope.contractId}
                    tokenId={id}
                    contextVersion={version}
                    style={scope.art}
                    size={128}
                    decorative
                  />
                </div>
              </div>
              <div className="min-w-0">
                <h1 className="text-4xl sm:text-6xl">{name}</h1>
                <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-mist">
                  <span className="chip text-mist">
                    Owned by{" "}
                    <span className="font-mono text-cream" title={kat.data.owner_id}>
                      {shorten(kat.data.owner_id, 12)}
                    </span>
                  </span>
                  <Link
                    to={`${scope.tokenPath(id)}/verify`}
                    className="chip chip-accent transition-colors hover:bg-lamp/20"
                  >
                    <Icon name="shield" size={14} />
                    Verify this {scope.noun}
                  </Link>
                </p>
                {version > 0 && (
                  <div className="mt-4">
                    <Growth contextVersion={version} plain={!scope.home} />
                  </div>
                )}
              </div>
            </header>
            {wallet.accountId === kat.data.owner_id ? (
              <Den
                key={`${scope.contractId}/${kat.data.owner_id}/${id}`}
                tokenId={id}
                ownerId={kat.data.owner_id}
                chainBalance={BigInt(kat.data.balance)}
                recheckOwner={reloadKat}
                onVersion={onVersion}
              />
            ) : (
              <Visitor
                key={`${scope.contractId}/${id}/${wallet.accountId ?? ""}`}
                tokenId={id}
                version={version}
              />
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
