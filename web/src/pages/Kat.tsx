import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Chat } from "../components/Chat.tsx";
import { FundPanel } from "../components/FundPanel.tsx";
import { GiveAwayPanel } from "../components/GiveAwayPanel.tsx";
import { KatBadge } from "../components/KatBadge.tsx";
import { PersonalityEditor } from "../components/PersonalityEditor.tsx";
import { Shell } from "../components/Shell.tsx";
import { shorten } from "../lib/format.ts";
import { KeeperError } from "../lib/keeper.ts";
import { describeProblem } from "../lib/problems.ts";
import { rememberProof } from "../lib/proof.ts";
import { useAsync } from "../lib/useAsync.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

/** How long to wait for the keeper to catch up with the chain before showing an error. */
const SETTLE_WAIT_MS = 2000;
const SETTLE_WAITS = 30;
/** Keeper answers that mean "not yet" when the contract already shows this wallet as owner. */
const SETTLING_CODES = ["waking_up", "not_owner", "not_found"];

/** The owner's side of the page: the conversation, and the panel that shapes the kat. */
function Den({ tokenId, chainBalance }: { tokenId: string; chainBalance: bigint }) {
  const { keeper, signer, session } = useServices();
  const navigate = useNavigate();
  const name = `Nearkat #${tokenId}`;
  const [context, reloadContext] = useAsync(session ? tokenId : null, () =>
    // Reads go through the session so the wallet is asked to sign in once.
    (session as NonNullable<typeof session>).call((token) => keeper.getContext(token, tokenId)),
  );
  // The keeper reports the balance after unsettled charges; the chain lags behind it.
  const [balance, setBalance] = useState(chainBalance);
  const [outOfBalance, setOutOfBalance] = useState(false);

  // The contract already says this wallet owns the kat. If the keeper disagrees
  // or the kat has no mind yet, the keeper is a few seconds behind the chain
  // (after a transfer or a mint), so wait for it instead of raising an alarm.
  const behind =
    context.status === "error" &&
    context.error instanceof KeeperError &&
    SETTLING_CODES.includes(context.error.code)
      ? context.error.code
      : null;
  const [waits, setWaits] = useState(0);
  const settling = behind !== null && waits < SETTLE_WAITS;
  useEffect(() => {
    // Each failed attempt bumps `waits`, which schedules the next one.
    if (behind === null || waits >= SETTLE_WAITS) {
      return;
    }
    const timer = setTimeout(() => {
      setWaits((count) => count + 1);
      void reloadContext();
    }, SETTLE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [behind, waits, reloadContext]);

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
      <p className="mt-10 text-mist">
        Approve the sign-in message in your wallet to open {name}'s mind.
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
        send={(message) => session.call((token) => keeper.chat(token, tokenId, message))}
        onReply={(reply) => {
          setBalance(BigInt(reply.balance));
          setOutOfBalance(false);
          rememberProof(tokenId, reply.verification);
          // A long conversation may have just been folded into memory.
          void reloadContext();
        }}
        onOutOfBalance={() => setOutOfBalance(true)}
      />
      <aside className="space-y-10 lg:border-l lg:border-cream/10 lg:pl-10">
        <PersonalityEditor
          key={context.data.version}
          personality={context.data.personality}
          save={async (prompt) => {
            await session.call((token) => keeper.setPersonality(token, tokenId, prompt));
            setBalance((current) => current - 5n * 10n ** 22n);
          }}
        />
        <section aria-labelledby="memory">
          <h3 id="memory" className="text-lg font-bold">
            Memory
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-mist">
            {context.data.memory_summary ||
              "Nothing remembered yet. After a longer conversation, the kat writes down what mattered."}
          </p>
        </section>
        <FundPanel
          balance={balance}
          urgent={outOfBalance}
          fund={async (amount) => {
            await signer.fund(tokenId, amount);
            setBalance((current) => current + amount);
            setOutOfBalance(false);
          }}
        />
        <GiveAwayPanel
          katName={name}
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
  const [kat] = useAsync(id, () => contract.getKat(id));
  const name = `Nearkat #${id}`;

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
              <KatBadge tokenId={id} size={88} />
              <div>
                <h1 className="text-4xl sm:text-5xl">{name}</h1>
                <p className="mt-2 text-sm text-mist">
                  Owned by{" "}
                  <span className="font-mono text-cream" title={kat.data.owner_id}>
                    {shorten(kat.data.owner_id, 12)}
                  </span>
                  <Link
                    to={`/kat/${id}/verify`}
                    className="ml-4 text-lamp underline underline-offset-4"
                  >
                    Verify this kat
                  </Link>
                </p>
              </div>
            </header>
            {wallet.accountId === kat.data.owner_id ? (
              <Den tokenId={id} chainBalance={BigInt(kat.data.balance)} />
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
