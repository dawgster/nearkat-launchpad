import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CharacterPanel } from "../components/CharacterPanel.tsx";
import { Chat } from "../components/Chat.tsx";
import { FundPanel } from "../components/FundPanel.tsx";
import { GiveAwayPanel } from "../components/GiveAwayPanel.tsx";
import { Growth } from "../components/Growth.tsx";
import { Shell } from "../components/Shell.tsx";
import { TokenArt } from "../components/TokenArt.tsx";
import { formatNear, shorten } from "../lib/format.ts";
import { KeeperError } from "../lib/keeper.ts";
import { describeProblem } from "../lib/problems.ts";
import { rememberProof } from "../lib/proof.ts";
import { useAsync } from "../lib/useAsync.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

/** How long to wait for the keeper to catch up with the chain before showing an error. */
const SETTLE_WAIT_MS = 2000;
const SETTLE_WAITS = 30;
/** Keeper answers that mean "not yet" while the contract shows this wallet as owner. */
const SETTLING_CODES = ["waking_up", "not_owner", "not_found"];

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
  const { config, contract, keeper, prices, signer, session } = useServices();
  const navigate = useNavigate();
  const name = `Nearkat #${tokenId}`;
  const [context, reloadContext] = useAsync(session ? `${ownerId}/${tokenId}` : null, () =>
    // Reads go through the session so the wallet is asked to sign in once.
    (session as NonNullable<typeof session>).call((token) => keeper.getContext(token, tokenId)),
  );
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
  useEffect(() => {
    if (version !== null) {
      onVersion(version);
    }
  }, [version, onVersion]);
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
      <p className="mt-10 text-lamp" role="status">
        {behind === "waking_up"
          ? `${name} is waking up. This takes a few seconds.`
          : `The keeper is catching up with the chain. ${name} will be here in a few seconds.`}
      </p>
    );
  }
  if (context.status === "loading") {
    return (
      <p className="mt-10 text-mist" role="status">
        Opening {name}'s mind. Your wallet may ask you to approve a sign-in message.
      </p>
    );
  }
  if (context.status === "error") {
    return (
      <div className="mt-10" role="alert">
        <p className="text-alarm">{describeProblem(context.error)}</p>
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
    <div className="mt-10 grid gap-12 lg:grid-cols-[1.5fr_1fr]">
      <Chat
        katName={name}
        chatPrice={prices.chat}
        send={(message) => session.call((token) => keeper.chat(token, tokenId, message))}
        onReply={(reply) => {
          setBalance(BigInt(reply.balance));
          setOutOfBalance(false);
          rememberProof(ownerId, tokenId, reply.verification);
          // A long conversation may have just been folded into memory.
          void reloadContext();
        }}
        onOutOfBalance={() => setOutOfBalance(true)}
        starters={
          context.data.version === 1
            ? [
                "Hello! Do you have a name?",
                "What can you see from your burrow?",
                "Want to hear about my day?",
              ]
            : ["What do you remember about me?", "How have you been?"]
        }
      />
      <aside className="min-w-0 space-y-10 lg:border-l lg:border-cream/10 lg:pl-10">
        <CharacterPanel character={context.data.personality} />
        <section aria-labelledby="memory">
          <h2 id="memory" className="font-sans text-lg font-bold">
            Memory
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-mist">
            {context.data.memory_summary ||
              "Nothing remembered yet. After a longer conversation, the kat writes down what mattered."}
          </p>
          <p className="mt-3 text-sm text-mist">
            Saving what it learned costs {formatNear(prices.save)} NEAR from its balance, after
            about ten exchanges.
          </p>
        </section>
        <FundPanel
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
        <GiveAwayPanel
          katName={name}
          ownerId={ownerId}
          network={config.networkId}
          accountExists={(accountId) => contract.accountExists(accountId)}
          give={async (receiverId) => {
            await signer.transfer(tokenId, receiverId);
            navigate("/");
          }}
        />
      </aside>
    </div>
  );
}

export function Kat() {
  const { id = "" } = useParams();
  const wallet = useWallet();
  const { contract } = useServices();
  const { config } = useServices();
  const [kat, reloadKat] = useAsync(id, () => contract.getKat(id));
  const name = `Nearkat #${id}`;
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
        <Link to="/" className="text-sm text-mist underline-offset-4 hover:underline">
          Back to the surface
        </Link>
        {kat.status === "loading" && <p className="mt-10 text-mist">Climbing down…</p>}
        {kat.status === "error" && (
          <p className="mt-10 text-alarm" role="alert">
            Can't read this kat from the contract. {describeProblem(kat.error)}
          </p>
        )}
        {kat.status === "ready" && !kat.data && (
          <div className="mt-10">
            <h1 className="text-4xl">This burrow is empty</h1>
            <p className="mt-3 text-mist">There is no {name}. It may not have been minted yet.</p>
          </div>
        )}
        {kat.status === "ready" && kat.data && (
          <>
            <header className="mt-6 flex flex-wrap items-center gap-5">
              <TokenArt
                contractId={config.contractId}
                tokenId={id}
                contextVersion={version}
                style="kat"
                size={120}
                decorative
              />
              <div className="min-w-0">
                <h1 className="text-4xl sm:text-5xl">{name}</h1>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mist">
                  <span>
                    Owned by{" "}
                    <span className="font-mono text-cream" title={kat.data.owner_id}>
                      {shorten(kat.data.owner_id, 12)}
                    </span>
                  </span>
                  <Link to={`/kat/${id}/verify`} className="text-lamp underline underline-offset-4">
                    Verify this kat
                  </Link>
                </p>
                {version > 0 && (
                  <div className="mt-3">
                    <Growth contextVersion={version} />
                  </div>
                )}
              </div>
            </header>
            {wallet.accountId === kat.data.owner_id ? (
              <Den
                key={`${kat.data.owner_id}/${id}`}
                tokenId={id}
                ownerId={kat.data.owner_id}
                chainBalance={BigInt(kat.data.balance)}
                recheckOwner={reloadKat}
                onVersion={onVersion}
              />
            ) : (
              <p className="mt-10 max-w-prose text-mist">
                {wallet.status === "connected"
                  ? `Only its owner can talk to ${name} or read its mind. The connected wallet isn't the owner.`
                  : `Only its owner can talk to ${name} or read its mind. Connect the wallet that owns it.`}
              </p>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
