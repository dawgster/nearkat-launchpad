import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useParams } from "react-router";
import { Shell } from "./components/Shell.tsx";
import { KatContract } from "./lib/contract.ts";
import { pricesFor } from "./lib/launchpad.ts";
import { describeProblem } from "./lib/problems.ts";
import { useAsync } from "./lib/useAsync.ts";
import { useServices } from "./services.tsx";
import { useWallet } from "./wallet/WalletProvider.tsx";

/**
 * Which collection a token page is about. The home collection is Nearkat;
 * any other is a collection launched on the launchpad, reached under
 * /c/:contract and served by the keeper under the same prefix.
 */
export interface Scope {
  contractId: string;
  home: boolean;
  /** The collection's name, as in "Nearkat #3". */
  name: string;
  /** What one token is called in running text. */
  noun: string;
  art: "kat" | "sigil";
  /** Reads the contract without a wallet. */
  contract: KatContract;
  /** Sends transactions as the connected account. Null while disconnected. */
  signer: KatContract | null;
  /** The collection the keeper should be asked about; undefined for the home one. */
  keeperCollection: string | undefined;
  /** Where a token's page is. */
  tokenPath(tokenId: string): string;
  /** Where "back" goes from a token page. */
  backPath: string;
  backLabel: string;
  /** What this collection charges, in yoctoNEAR. */
  prices: { chat: bigint; save: bigint };
  /** Openers for a fresh conversation, and for one already under way. */
  starters: { fresh: string[]; later: string[] };
}

const ScopeContext = createContext<Scope | null>(null);

export function useScope(): Scope {
  const scope = useContext(ScopeContext);
  if (!scope) {
    throw new Error("useScope must be used inside a collection scope");
  }
  return scope;
}

/** The home collection. */
export function HomeScope({ children }: { children: ReactNode }) {
  const { config, contract, signer, prices } = useServices();
  const scope = useMemo<Scope>(
    () => ({
      contractId: config.contractId,
      home: true,
      name: "Nearkat",
      noun: "kat",
      art: "kat",
      contract,
      signer,
      keeperCollection: undefined,
      prices,
      tokenPath: (tokenId) => `/kat/${tokenId}`,
      backPath: "/",
      backLabel: "Back to the surface",
      starters: {
        fresh: [
          "Hello! Do you have a name?",
          "What can you see from your burrow?",
          "Want to hear about my day?",
        ],
        later: ["What do you remember about me?", "How have you been?"],
      },
    }),
    [config, contract, signer, prices],
  );
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

/** A collection named in the route, `/c/:contractId/...`. */
export function ContractScope({ children }: { children: ReactNode }) {
  const { contractId = "" } = useParams();
  const { config, reader, prices } = useServices();
  const wallet = useWallet();
  const contract = useMemo(() => new KatContract(reader, contractId), [reader, contractId]);
  const home = contractId === config.contractId;
  const [collection] = useAsync(home ? null : `collection/${contractId}`, () =>
    contract.getCollection(),
  );
  const signer = useMemo(
    () => (wallet.near ? new KatContract(wallet.near, contractId) : null),
    [wallet.near, contractId],
  );
  const scope = useMemo<Scope | null>(() => {
    if (collection.status !== "ready") {
      return null;
    }
    return {
      contractId,
      home: false,
      name: collection.data.name,
      noun: "token",
      art: "sigil",
      contract,
      signer,
      keeperCollection: contractId,
      prices: pricesFor(collection.data.terms, prices),
      tokenPath: (tokenId) => `/c/${contractId}/kat/${tokenId}`,
      backPath: `/c/${contractId}`,
      backLabel: `Back to ${collection.data.name}`,
      starters: {
        fresh: ["Hello! Who are you?", "What can we do together?"],
        later: ["What do you remember about me?", "Where did we leave off?"],
      },
    };
  }, [collection, contract, signer, contractId, prices]);

  if (home) {
    return <HomeScope>{children}</HomeScope>;
  }
  if (!scope) {
    return (
      <Shell world="burrow">
        <p
          className={collection.status === "error" ? "text-alarm" : "text-mist"}
          role={collection.status === "error" ? "alert" : "status"}
        >
          {collection.status === "error"
            ? `Can't read this collection. ${describeProblem(collection.error)}`
            : "Reading the collection…"}
        </p>
      </Shell>
    );
  }
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

/** The key a reply's proof is kept under: the home collection keeps its plain token ids. */
export function proofId(scope: Scope, tokenId: string): string {
  return scope.home ? tokenId : `${scope.contractId}:${tokenId}`;
}
