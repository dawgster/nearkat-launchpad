/** Where a token's encrypted context is kept, read from the ref its contract records. */
export type ContextLocation =
  | {
      kind: "fastfs";
      uploader: string;
      sha256: string;
      txHash: string;
      /** The FastFS gateway's copy, where one serves this network. */
      url: string | null;
      /** The upload transaction in an explorer, where one covers this network. */
      explorer: string | null;
    }
  | { kind: "keeper" };

const FASTFS_REF = /^fastfs:([a-z0-9._-]{2,64}):([0-9a-f]{64}):([1-9A-HJ-NP-Za-km-z]{32,44})$/;

export function contextLocation(
  ref: string | null,
  contractId: string,
  networkId: "testnet" | "mainnet" | "sandbox",
): ContextLocation {
  const match = ref ? FASTFS_REF.exec(ref) : null;
  if (!match) {
    return { kind: "keeper" };
  }
  const [, uploader = "", sha256 = "", txHash = ""] = match;
  return {
    kind: "fastfs",
    uploader,
    sha256,
    txHash,
    url:
      networkId === "mainnet"
        ? `https://${uploader}.fastfs.io/${contractId}/nearkat/${sha256}.bin`
        : null,
    explorer:
      networkId === "sandbox"
        ? null
        : `https://${networkId === "testnet" ? "testnet." : ""}nearblocks.io/txns/${txHash}`,
  };
}
