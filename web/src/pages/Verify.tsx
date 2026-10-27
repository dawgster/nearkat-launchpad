import { type ReactNode, useEffect } from "react";
import { Link, useParams } from "react-router";
import { Shell } from "../components/Shell.tsx";
import { describeProblem } from "../lib/problems.ts";
import { recallProof } from "../lib/proof.ts";
import { type ContextLocation, contextLocation } from "../lib/storage.ts";
import { checkPhalaReport, type PhalaReport } from "../lib/tdx.ts";
import { useAsync } from "../lib/useAsync.ts";
import {
  keyVerdict,
  privacyVerdict,
  recordVerdict,
  signatureVerdict,
  type Verdict,
} from "../lib/verdicts.ts";
import { checkSignature, contextHash } from "../lib/verify.ts";
import { proofId, useScope } from "../scope.tsx";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

const MARK: Record<Verdict, { label: string; className: string }> = {
  pass: { label: "Checked", className: "bg-glow text-night" },
  partial: { label: "Partly checked", className: "bg-lamp text-earth" },
  fail: { label: "Failed", className: "bg-alarm text-night" },
  unknown: { label: "Not checked", className: "border border-cream/50 text-cream" },
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
    <li className="grid gap-x-6 gap-y-2 border-t border-cream/15 py-6 sm:grid-cols-[9rem_1fr]">
      <span
        className={`h-fit w-fit rounded px-2 py-1 text-sm font-bold ${MARK[verdict].className}`}
      >
        {MARK[verdict].label}
      </span>
      <div className="min-w-0">
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

function safeHash(compute: () => string): string | null {
  try {
    return compute();
  } catch {
    return null;
  }
}

/** Where the encrypted mind is kept, and where anyone can fetch it. */
function Stored({ location, keyEpoch }: { location: ContextLocation; keyEpoch?: number }) {
  if (location.kind === "keeper") {
    return <p>The encrypted mind is kept by the keeper.</p>;
  }
  const link = location.url ?? location.explorer;
  return (
    <p>
      The encrypted mind is stored on NEAR itself, with FastFS, in a transaction from{" "}
      <Mono>{location.uploader}</Mono>
      {link ? (
        <>
          {" "}
          (
          <a className="underline" href={link} target="_blank" rel="noreferrer">
            {location.url ? "download it" : "see the transaction"}
          </a>
          )
        </>
      ) : null}
      . Anyone can fetch it; only the key opens it
      {keyEpoch ? (
        <>
          : this collection's key for epoch {keyEpoch}, which NEAR's MPC network gives only to the
          keeper the contract names
        </>
      ) : null}
      .
    </p>
  );
}

export function Verify() {
  const { id = "" } = useParams();
  const wallet = useWallet();
  const { config, keeper, session } = useServices();
  const scope = useScope();
  const { contract } = scope;
  const name = `${scope.name} #${id}`;
  const [chain, reloadChain] = useAsync(`${scope.contractId}/${id}`, async () => ({
    kat: await contract.getKat(id),
    config: await contract.getConfig(),
    // Older contracts have no collection view; that only means no TEE requirement.
    collection: await contract.getCollection().catch(() => null),
  }));
  const [attestation] = useAsync("attestation", () => keeper.attestation());
  const kat = chain.status === "ready" ? chain.data.kat : null;
  const isOwner = kat !== null && wallet.accountId !== null && kat.owner_id === wallet.accountId;
  const [context] = useAsync(
    isOwner && session ? `${scope.contractId}/${wallet.accountId}/${id}` : null,
    () =>
      (session as NonNullable<typeof session>).call((token) =>
        keeper.getContext(token, id, scope.keeperCollection),
      ),
  );
  const keeperKey =
    attestation.status === "ready" && typeof attestation.data.keeper_public_key === "string"
      ? attestation.data.keeper_public_key
      : null;
  const keeperId = chain.status === "ready" ? chain.data.config.keeper_id : null;
  const [keyHeld] = useAsync(keeperKey && keeperId ? `${keeperId}/${keeperKey}` : null, () =>
    contract.accountHoldsKey(keeperId as string, keeperKey as string),
  );
  const requiresTee = chain.status === "ready" && chain.data.collection?.tee != null;
  const [keyAttested] = useAsync(
    requiresTee && keeperKey ? `${scope.contractId}/attested/${keeperKey}` : null,
    () => contract.isKeeperKeyAttested(keeperKey as string),
  );

  const record = recordVerdict(context.status === "ready" ? context.data : null, {
    context_hash: kat?.context_hash ?? null,
    context_version: kat?.context_version ?? "0",
  });
  // The contract was read before or after the keeper's copy was saved. Read it again.
  useEffect(() => {
    if (record !== "behind") {
      return;
    }
    const timer = setTimeout(() => void reloadChain(), 2000);
    return () => clearTimeout(timer);
  }, [record, reloadChain]);

  if (chain.status === "loading") {
    return (
      <Shell world="burrow">
        <p className="text-mist">Reading the contract…</p>
      </Shell>
    );
  }
  if (chain.status === "error" || !kat) {
    return (
      <Shell world="burrow">
        <p className="text-alarm" role="alert">
          {chain.status === "error"
            ? `Can't read the contract. ${describeProblem(chain.error)}`
            : `There is no ${name}.`}
        </p>
      </Shell>
    );
  }

  const recomputed = context.status === "ready" ? safeHash(() => contextHash(context.data)) : null;
  const mode = attestation.status === "ready" ? String(attestation.data.mode ?? "unknown") : null;
  const proof =
    isOwner && wallet.accountId ? recallProof(wallet.accountId, proofId(scope, id)) : null;
  const requiredApp = chain.data.collection?.tee?.Phala.app_id ?? null;
  const phala =
    mode === "phala" && attestation.status === "ready"
      ? checkPhalaReport(attestation.data as unknown as PhalaReport)
      : null;
  const reportedApp =
    attestation.status === "ready" && typeof attestation.data.app_id === "string"
      ? attestation.data.app_id
      : null;
  const composeHash =
    attestation.status === "ready" && typeof attestation.data.compose_hash === "string"
      ? attestation.data.compose_hash
      : null;
  const signature = proof ? checkSignature(proof) : null;

  return (
    <Shell world="burrow">
      <Link
        to={scope.tokenPath(id)}
        className="text-sm text-mist underline-offset-4 hover:underline"
      >
        Back to {name}
      </Link>
      <h1 className="mt-6 text-4xl sm:text-5xl">Verify {name}</h1>
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
                The contract holds a fingerprint of version {kat.context_version} of this{" "}
                {scope.noun}'s mind. The keeper can't swap in a different mind without changing it.
              </p>
              <p>
                Fingerprint <Mono>{kat.context_hash}</Mono>
              </p>
              <Stored
                location={contextLocation(kat.context_ref, scope.contractId, config.networkId)}
                keyEpoch={kat.key_epoch}
              />
            </>
          ) : (
            <p>This kat is still waking up and has no recorded mind yet.</p>
          )}
        </Check>

        <Check
          verdict={record === "match" ? "pass" : record === "mismatch" ? "fail" : "unknown"}
          title="What you see is what's recorded"
        >
          {!isOwner && (
            <p>Only the owner can check this, because only the owner can read the mind.</p>
          )}
          {isOwner && context.status === "loading" && <p>Fetching its mind from the keeper…</p>}
          {isOwner && context.status === "error" && <p>{describeProblem(context.error)}</p>}
          {record === "behind" && (
            <p>The keeper just saved a newer version. Reading the contract again…</p>
          )}
          {record === "match" && (
            <p>
              Your browser recomputed the fingerprint from the personality and memory the keeper
              sent you, and it matches the contract.
            </p>
          )}
          {record === "mismatch" && (
            <p>
              The personality and memory the keeper sent you do not produce the fingerprint in the
              contract. Don't trust what this keeper shows you.
            </p>
          )}
          {recomputed && (record === "match" || record === "mismatch") && (
            <p>
              Recomputed <Mono>{recomputed}</Mono>
            </p>
          )}
        </Check>

        <Check
          verdict={keyVerdict(keyHeld.status === "ready" ? keyHeld.data : null)}
          title="The keeper is the one the contract trusts"
        >
          {attestation.status === "error" && <p>{describeProblem(attestation.error)}</p>}
          {keeperId && (
            <p>
              The contract accepts updates from <Mono>{keeperId}</Mono>.
            </p>
          )}
          {keyHeld.status === "ready" && keyHeld.data && (
            <p>
              That account holds the key this keeper reports. Keys are public, so this alone doesn't
              prove the service you are talking to controls it.
            </p>
          )}
          {keyHeld.status === "ready" && !keyHeld.data && (
            <p>That account does not hold the key this keeper reports.</p>
          )}
          {keyHeld.status === "error" && <p>The account's keys couldn't be looked up just now.</p>}
          {keeperKey && (
            <p>
              Reported key <Mono>{keeperKey}</Mono>
            </p>
          )}
        </Check>

        <Check
          verdict={privacyVerdict(
            mode,
            phala,
            requiredApp,
            keyAttested.status === "ready" ? keyAttested.data : null,
          )}
          title="Nobody but the owner can read its mind"
        >
          {requiredApp && (
            <p>
              This collection allows its minds to be opened only inside Phala app{" "}
              <Mono>{requiredApp}</Mono>.
            </p>
          )}
          {mode === "local" && (
            <p>
              Not yet. This keeper reports that it runs in local mode, so whoever operates it can
              read every mind it holds. That changes when the keeper moves into a sealed enclave.
            </p>
          )}
          {mode === "phala" && phala?.status === "unreadable" && (
            <p>The keeper's enclave report can't be read: {phala.reason}.</p>
          )}
          {mode === "phala" && phala?.status === "read" && (
            <>
              <p>
                The keeper reports that it runs as Phala app <Mono>{reportedApp ?? "?"}</Mono>,
                whose keys come from dstack's key service and are never seen by its operator.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  {phala.bindsKey
                    ? "Its TDX quote commits to the key the keeper signs with."
                    : "Its TDX quote does not commit to the key the keeper reports."}
                </li>
                <li>
                  {phala.logMatchesQuote
                    ? "Its event log replays to the measurement in the quote."
                    : "Its event log does not match the measurement in the quote."}
                </li>
                <li>
                  {phala.appId === null
                    ? "Its event log has no intact app id."
                    : phala.claimMatchesLog
                      ? `The measured app id is ${phala.appId}.`
                      : `The measured app id is ${phala.appId}, not the one it reports.`}
                </li>
                {requiredApp && phala.appId !== null && phala.appId !== requiredApp && (
                  <li>That is not the app this collection requires.</li>
                )}
              </ul>
              {keyAttested.status === "ready" && keyAttested.data && (
                <p>
                  The contract itself has verified this keeper's TDX quote, Intel's signature
                  included, and only accepts updates signed with its key.
                </p>
              )}
              {keyAttested.status === "ready" && !keyAttested.data && (
                <p>
                  The contract has not accepted this keeper's key, so it would refuse its updates.
                </p>
              )}
              <p>
                {keyAttested.status === "ready" && keyAttested.data
                  ? "Not checked here: which code versions (compose hashes) the app's key service allows. Its owner controls that list."
                  : "Not checked here: Intel's signature on the quote, and which code versions (compose hashes) the app's key service allows. Paste the quote into Phala's attestation explorer to check those."}
                {composeHash && (
                  <>
                    {" "}
                    Running compose hash <Mono>{composeHash}</Mono>.
                  </>
                )}
              </p>
            </>
          )}
          {mode !== "local" && mode !== "phala" && (
            <p>
              {mode
                ? `The keeper reports mode "${mode}", which this page can't check.`
                : "The keeper's report isn't available."}
            </p>
          )}
        </Check>

        <Check
          verdict={signatureVerdict(signature)}
          title="Its latest reply was signed by the model's host"
        >
          {!isOwner && <p>Only the owner's own conversation can be checked here.</p>}
          {isOwner && !proof && (
            <p>Talk to it in this tab, then come back to check its latest reply.</p>
          )}
          {signature?.status === "missing" && (
            <p>The model's host sent no signature with the latest reply.</p>
          )}
          {signature?.status === "unsupported" && (
            <p>The reply was signed with {signature.algo}, which this page can't check.</p>
          )}
          {signature?.status === "invalid" && (
            <p>The signature on the latest reply is not valid.</p>
          )}
          {signature?.status === "valid" && !signature.coversReply && (
            <p>The signature is valid, but it was made over something other than this reply.</p>
          )}
          {signature?.status === "valid" && signature.coversReply && (
            <>
              <p>
                The reply's fingerprints were signed by <Mono>{signature.signer}</Mono>.
              </p>
              <p>
                What this page can't check yet is whose key that is. To be sure it belongs to the
                model's enclave, compare it with NEAR AI's published attestation for {proof?.model}.
              </p>
            </>
          )}
        </Check>
      </ul>
    </Shell>
  );
}
