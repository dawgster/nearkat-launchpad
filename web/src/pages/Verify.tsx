import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Shell } from "../components/Shell.tsx";
import { describeProblem } from "../lib/problems.ts";
import { recallProof } from "../lib/proof.ts";
import { useAsync } from "../lib/useAsync.ts";
import { checkSignature, contextHash } from "../lib/verify.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

type Verdict = "pass" | "fail" | "unknown";

const MARK: Record<Verdict, { label: string; className: string }> = {
  pass: { label: "Checked", className: "bg-glow text-night" },
  fail: { label: "Failed", className: "bg-alarm text-night" },
  unknown: { label: "Not checked", className: "border border-cream/40 text-cream" },
};

function Check({
  verdict,
  title,
  children,
}: {
  verdict: Verdict;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid gap-x-6 gap-y-2 border-t border-cream/15 py-6 sm:grid-cols-[8rem_1fr]">
      <span
        className={`h-fit w-fit rounded px-2 py-1 text-sm font-bold ${MARK[verdict].className}`}
      >
        {MARK[verdict].label}
      </span>
      <div>
        <h2 className="font-sans text-lg font-bold">{title}</h2>
        <div className="mt-1 max-w-prose space-y-2 text-sm leading-relaxed text-mist">
          {children}
        </div>
      </div>
    </li>
  );
}

const Mono = ({ children }: { children: ReactNode }) => (
  <span className="break-all font-mono text-cream">{children}</span>
);

export function Verify() {
  const { id = "" } = useParams();
  const wallet = useWallet();
  const { contract, keeper, session } = useServices();
  const [chain] = useAsync(id, async () => ({
    kat: await contract.getKat(id),
    config: await contract.getConfig(),
  }));
  const [attestation] = useAsync("attestation", () => keeper.attestation());
  const isOwner = chain.status === "ready" && chain.data.kat?.owner_id === wallet.accountId;
  const [context] = useAsync(isOwner && session ? id : null, () =>
    (session as NonNullable<typeof session>).call((token) => keeper.getContext(token, id)),
  );
  const keeperKey =
    attestation.status === "ready" && typeof attestation.data.keeper_public_key === "string"
      ? attestation.data.keeper_public_key
      : null;
  const keeperId = chain.status === "ready" ? chain.data.config.keeper_id : null;
  const [keyHeld] = useAsync(keeperKey && keeperId ? `${keeperId}/${keeperKey}` : null, () =>
    contract.accountHoldsKey(keeperId as string, keeperKey as string),
  );
  const proof = recallProof(id);
  const signature = proof ? checkSignature(proof) : null;

  if (chain.status === "loading") {
    return (
      <Shell world="burrow">
        <p className="text-mist">Reading the contract…</p>
      </Shell>
    );
  }
  if (chain.status === "error" || !chain.data.kat) {
    return (
      <Shell world="burrow">
        <p className="text-alarm" role="alert">
          {chain.status === "error"
            ? `Can't read the contract. ${describeProblem(chain.error)}`
            : `There is no Nearkat #${id}.`}
        </p>
      </Shell>
    );
  }
  const { kat } = chain.data;
  const matches =
    context.status === "ready" ? contextHash(context.data) === kat.context_hash : null;
  const local = attestation.status === "ready" && attestation.data.mode === "local";

  return (
    <Shell world="burrow">
      <Link to={`/kat/${id}`} className="text-sm text-mist underline-offset-4 hover:underline">
        Back to Nearkat #{id}
      </Link>
      <h1 className="mt-6 text-4xl sm:text-5xl">Verify Nearkat #{id}</h1>
      <p className="mt-4 max-w-prose text-mist">
        What this page can check for itself, in your browser, and what it can't.
      </p>
      <ul className="mt-10">
        <Check
          verdict={kat.context_hash ? "pass" : "unknown"}
          title="Its mind is recorded on-chain"
        >
          {kat.context_hash ? (
            <>
              <p>
                The contract holds a fingerprint of version {kat.context_version} of this kat's
                mind. The keeper can't swap in a different mind without changing it.
              </p>
              <p>
                Fingerprint <Mono>{kat.context_hash}</Mono>
              </p>
            </>
          ) : (
            <p>This kat is still waking up and has no recorded mind yet.</p>
          )}
        </Check>

        <Check
          verdict={matches === null ? "unknown" : matches ? "pass" : "fail"}
          title="What you see is what's recorded"
        >
          {!isOwner && (
            <p>Only the owner can check this, because only the owner can read the mind.</p>
          )}
          {isOwner && context.status === "loading" && (
            <p>Fetching your kat's mind from the keeper…</p>
          )}
          {isOwner && context.status === "error" && <p>{describeProblem(context.error)}</p>}
          {matches === true && (
            <p>
              Your browser recomputed the fingerprint from the personality and memory the keeper
              sent you, and it matches the contract.
            </p>
          )}
          {matches === false && (
            <p>
              The personality and memory the keeper sent you do not produce the fingerprint in the
              contract. Don't trust what this keeper shows you.
            </p>
          )}
        </Check>

        <Check
          verdict={keyHeld.status === "ready" ? (keyHeld.data ? "pass" : "fail") : "unknown"}
          title="The keeper is the one the contract trusts"
        >
          {attestation.status === "error" && <p>{describeProblem(attestation.error)}</p>}
          {keeperKey && keeperId && (
            <p>
              The contract accepts updates from <Mono>{keeperId}</Mono>.{" "}
              {keyHeld.status === "ready" &&
                (keyHeld.data
                  ? "That account holds the key this keeper reports."
                  : "That account does not hold the key this keeper reports.")}
            </p>
          )}
        </Check>

        <Check verdict={local ? "fail" : "unknown"} title="Nobody but the owner can read its mind">
          {local ? (
            <p>
              Not yet. This keeper runs in local mode, so whoever operates it can read every kat's
              mind. That changes when the keeper moves into a sealed enclave.
            </p>
          ) : (
            <p>This page can't check the keeper's enclave report yet.</p>
          )}
        </Check>

        <Check
          verdict={
            !signature || signature.status === "missing" || signature.status === "unsupported"
              ? "unknown"
              : signature.status === "valid" && signature.coversReply
                ? "pass"
                : "fail"
          }
          title="Its latest reply was signed by the model's host"
        >
          {!proof && <p>Talk to this kat in this tab, then come back to check its latest reply.</p>}
          {signature?.status === "missing" && (
            <p>The model's host sent no signature with the latest reply.</p>
          )}
          {signature?.status === "unsupported" && (
            <p>The reply was signed with {signature.algo}, which this page can't check.</p>
          )}
          {signature?.status === "invalid" && (
            <p>The signature on the latest reply is not valid.</p>
          )}
          {signature?.status === "valid" && (
            <>
              <p>
                Signed by <Mono>{signature.signer}</Mono>
                {signature.coversReply
                  ? ", and the signed text names this reply."
                  : ", but the signed text does not name this reply."}
              </p>
              <p>
                This page doesn't yet check that this signer is the model's enclave. Compare it with
                NEAR AI's published attestation for {proof?.model}.
              </p>
            </>
          )}
        </Check>
      </ul>
    </Shell>
  );
}
