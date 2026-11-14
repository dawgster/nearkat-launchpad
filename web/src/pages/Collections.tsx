import { useMemo } from "react";
import { Link } from "react-router";
import { Icon } from "../components/Icon.tsx";
import { Shell } from "../components/Shell.tsx";
import { TokenArt } from "../components/TokenArt.tsx";
import { KatContract } from "../lib/contract.ts";
import { shorten } from "../lib/format.ts";
import type { CollectionView } from "../lib/launchpad.ts";
import { describeProblem } from "../lib/problems.ts";
import { type Async, useAsync } from "../lib/useAsync.ts";
import { useServices } from "../services.tsx";

/** What a collection holds, in a few words: its kind and how much of it there is. */
export function collectionSummary(view: CollectionView): { kind: string; count: string } {
  const dataset =
    typeof view.kind === "object" && "Dataset" in view.kind ? view.kind.Dataset : null;
  if (dataset) {
    return {
      kind: "Dataset",
      count: `${view.minted} sealed samples · ${dataset.classes.join(" / ")}`,
    };
  }
  return {
    kind: "Characters",
    count: view.max_supply
      ? `${view.minted} of ${view.max_supply} minted`
      : `${view.minted} minted`,
  };
}

/** One collection in the list. It links to the collection as soon as its address is known. */
export function CollectionTile({
  contractId,
  home,
  name,
  symbol,
  creator,
  details,
}: {
  contractId: string;
  /** The app's own collection, drawn as kats. */
  home: boolean;
  /** From the launchpad's list, shown until the collection itself has answered. */
  name?: string;
  symbol?: string;
  creator?: string;
  details: Async<CollectionView>;
}) {
  const view = details.status === "ready" ? details.data : null;
  const summary = view ? collectionSummary(view) : null;
  return (
    <Link
      to={`/c/${contractId}`}
      className="card group flex h-full items-start gap-5 transition-colors hover:border-glow/50"
    >
      <TokenArt
        contractId={contractId}
        tokenId="1"
        contextVersion={4}
        style={home ? "kat" : "sigil"}
        size={88}
        decorative
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-2xl group-hover:text-glow">
          {view?.name ?? name ?? shorten(contractId, 16)}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {(view?.symbol ?? symbol) && (
            <span className="chip font-mono">{view?.symbol ?? symbol}</span>
          )}
          {summary && <span className="chip text-mist">{summary.kind}</span>}
          {view?.tee && (
            <span className="chip chip-accent">
              <Icon name="lock" size={14} />
              TEE only
            </span>
          )}
        </span>
        <span className="mt-3 block text-sm text-mist">
          {summary
            ? summary.count
            : details.status === "error"
              ? `Can't read it. ${describeProblem(details.error)}`
              : "Reading…"}
        </span>
        <span className="mt-1 block truncate text-sm text-mist">
          {creator ? (
            <>
              by <span className="font-mono">{shorten(creator, 12)}</span>
            </>
          ) : (
            <span className="font-mono">{shorten(contractId, 28)}</span>
          )}
        </span>
      </span>
    </Link>
  );
}

function LoadedTile(props: {
  contractId: string;
  home: boolean;
  name?: string;
  symbol?: string;
  creator?: string;
}) {
  const { reader } = useServices();
  const contract = useMemo(
    () => new KatContract(reader, props.contractId),
    [reader, props.contractId],
  );
  const [details] = useAsync(`collection/${props.contractId}`, () => contract.getCollection());
  return <CollectionTile {...props} details={details} />;
}

/** Every collection this app knows: its own, then the ones launched on the launchpad. */
export function Collections() {
  const { config, launchpad } = useServices();
  const [listing] = useAsync(launchpad ? "collections" : null, () =>
    (launchpad as NonNullable<typeof launchpad>).collections(),
  );
  const launched =
    listing.status === "ready"
      ? listing.data.filter((entry) => entry.live && entry.account_id !== config.contractId)
      : [];
  return (
    <Shell world="surface">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-8 sm:pt-12">
        <div>
          <h1 className="text-4xl sm:text-6xl">Collections</h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-mist">
            Characters you raise by talking to them, and datasets whose samples stay sealed while a
            model trains on them.
          </p>
        </div>
        {launchpad && (
          <Link to="/launch" className="button px-5 py-2.5">
            Launch your own
          </Link>
        )}
      </div>
      <ul className="mt-10 grid gap-5 lg:grid-cols-2">
        <li>
          <LoadedTile contractId={config.contractId} home />
        </li>
        {launched.map((entry) => (
          <li key={entry.account_id}>
            <LoadedTile
              contractId={entry.account_id}
              home={false}
              name={entry.name}
              symbol={entry.symbol}
              creator={entry.creator_id}
            />
          </li>
        ))}
      </ul>
      {launchpad && listing.status === "loading" && (
        <p className="mt-6 text-mist" role="status">
          Looking for launched collections…
        </p>
      )}
      {listing.status === "error" && (
        <p className="mt-6 text-alarm" role="alert">
          Can't list launched collections. {describeProblem(listing.error)}
        </p>
      )}
    </Shell>
  );
}
