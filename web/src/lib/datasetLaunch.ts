import type { Near } from "near-kit";
import { KatContract } from "./contract.ts";
import { type Keeper, KeeperError } from "./keeper.ts";
import type { Launchpad } from "./launchpad.ts";
import { sealSample } from "./samples.ts";
import type { KeeperSession } from "./session.ts";
import { checkPhalaReport, type PhalaReport, privacyOf } from "./tdx.ts";

/** Samples handed to the keeper per request; its limit. */
export const SAMPLES_PER_CALL = 25;
/** How long to wait for the keeper to find a new launch before giving up. */
const FIND_WAIT_MS = 2000;
const FIND_WAITS = 30;

/**
 * The sealing key of this app's keeper, after checking in the browser that
 * the keeper's quote binds that key and comes from the chosen Phala app. The
 * contract checks the same quote, Intel's signature included, when the
 * keeper registers. `what` names what is being sealed, for the error.
 */
export function sealKeyForApp(
  report: Record<string, unknown>,
  appId: string,
  what: string,
): string {
  const phala = report as Partial<PhalaReport> & { mode?: string };
  const check = phala.mode === "phala" ? checkPhalaReport(phala as PhalaReport) : null;
  if (
    check?.status !== "read" ||
    !check.bindsKey ||
    !check.logMatchesQuote ||
    check.appId !== appId ||
    !phala.seal_public_key
  ) {
    throw new Error(
      `${what} are sealed to this app's keeper, and it isn't running as Phala app ${appId}, so there is no key inside that app to seal them to.`,
    );
  }
  return phala.seal_public_key;
}

/** Runs a keeper call, waiting while the keeper hasn't found the collection yet. */
export async function untilFound<T>(run: () => Promise<T>, waitMs = FIND_WAIT_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const finding =
        error instanceof KeeperError &&
        (error.code === "not_served" || error.code === "minting_unfinished");
      if (!finding || attempt >= FIND_WAITS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/** Whether `collection` is the same dataset, so a launch that stopped part way can go on. */
export function sameDataset(
  collection: { kind?: unknown; class_counts?: string[] },
  classes: string[],
  counts: number[],
): boolean {
  const kind = collection.kind as { Dataset?: { classes?: string[] } } | undefined;
  return (
    JSON.stringify(kind?.Dataset?.classes) === JSON.stringify(classes) &&
    JSON.stringify(collection.class_counts) === JSON.stringify(counts.map(String))
  );
}

export type LaunchProgress = {
  step: "sealing" | "launching" | "storing";
  done: number;
  total: number;
};

/** The pictures of a dataset, in token order: token `i + 1` is `samples[i]`. */
export interface LaunchSamples {
  classes: string[];
  samples: Array<{ label: string; jpeg: Uint8Array }>;
}

export interface DatasetLaunchServices {
  /** Reads the launchpad. */
  launchpad: Pick<Launchpad, "accountFor" | "isTaken">;
  /** Sends the launch as the connected account. */
  launcher: Pick<Launchpad, "launch">;
  keeper: Pick<Keeper, "attestation" | "sealSamples">;
  session: Pick<KeeperSession, "call">;
  /** Reads a collection that may already be launched. */
  reader: Near;
  /** The connected account. */
  accountId: string | null;
  /** Where the keeper draws token art, for collections without their own images. */
  keeperUrl: string;
}

export interface DatasetLaunchOptions {
  slug: string;
  name: string;
  symbol: string;
  royaltyBps: number;
  /** The Phala app (and optionally its keeper's account) the pictures are sealed to. */
  app: { appId: string; keeperId: string } | null;
  ownImages: { baseUri: string; extension: string } | null;
  /** The creator accepts sealing to a keeper that isn't a confirmed TEE. */
  understood: boolean;
  /** yoctoNEAR attached to a new launch; nothing is paid when resuming. */
  deposit: bigint;
  onProgress?: (progress: LaunchProgress) => void;
}

/**
 * Seals every picture in this browser, launches with one wallet
 * confirmation, then hands the sealed samples to the keeper in batches.
 * A dataset already launched to this address by this creator is not
 * launched again: only the samples it is missing are stored. Everything that
 * can refuse the launch is checked before any picture is sealed.
 */
export async function launchDataset(
  services: DatasetLaunchServices,
  chosen: LaunchSamples,
  options: DatasetLaunchOptions,
): Promise<{ count: number; account: string }> {
  const { launchpad, launcher, keeper, session, reader, accountId, keeperUrl } = services;
  const progress = options.onProgress ?? (() => undefined);
  if (!accountId || !session) {
    throw new Error("Connect your wallet first.");
  }
  const account = launchpad.accountFor(options.slug);
  const counts = chosen.classes.map((c) => chosen.samples.filter((s) => s.label === c).length);
  const report = await keeper.attestation();
  const sealKey = options.app
    ? sealKeyForApp(report, options.app.appId, "Samples")
    : typeof report.seal_public_key === "string"
      ? report.seal_public_key
      : null;
  if (!sealKey) {
    throw new Error("This keeper has no sealing key, so the pictures can't be sealed to it.");
  }
  if (!options.app && privacyOf(report).kind !== "tee" && !options.understood) {
    throw new Error("Confirm that this keeper may see the pictures.");
  }

  // An address that is taken is only fine if it is this creator's unfinished launch of this dataset.
  const resuming = await launchpad.isTaken(options.slug);
  if (resuming) {
    const existing = new KatContract(reader, account);
    const [collection, contractConfig] = await Promise.all([
      existing.getCollection(),
      existing.getConfig(),
    ]);
    if (contractConfig.admin_id !== accountId || !sameDataset(collection, chosen.classes, counts)) {
      throw new Error("That address is taken.");
    }
  }

  const total = chosen.samples.length;
  const sealed: string[] = [];
  for (const sample of chosen.samples) {
    progress({ step: "sealing", done: sealed.length, total });
    sealed.push(await sealSample(sealKey, sample.label, sample.jpeg));
  }

  // Signing in first, so the wallet's one transaction is the last thing it is asked for.
  await session.call(async () => undefined);
  if (!resuming) {
    progress({ step: "launching", done: 0, total: 1 });
    await launcher.launch(
      {
        slug: options.slug,
        name: options.name,
        symbol: options.symbol,
        mintPrice: 0n,
        prompt: "",
        starter: "",
        maxSupply: null,
        phalaAppId: options.app ? options.app.appId : null,
        keeperId: options.app?.keeperId.trim() ? options.app.keeperId.trim() : null,
        images: options.ownImages ?? { baseUri: `${keeperUrl}/art/${account}/`, extension: "svg" },
        terms: {
          royaltyBps: options.royaltyBps,
          creatorShareBps: 0,
          chatPrice: null,
          savePrice: null,
        },
        sealedPrompt: null,
        historyImport: false,
        dataset: { classes: chosen.classes, classCounts: counts },
      },
      options.deposit,
    );
    if (!(await launchpad.isTaken(options.slug))) {
      throw new Error("The launch did not go through. Your deposit was refunded.");
    }
  }

  let stored = 0;
  progress({ step: "storing", done: 0, total });
  for (let start = 0; start < total; start += SAMPLES_PER_CALL) {
    const batch = sealed
      .slice(start, start + SAMPLES_PER_CALL)
      .map((text, i) => ({ token_id: String(start + i + 1), sealed: text }));
    const result = await untilFound(() =>
      session.call((token) => keeper.sealSamples(token, account, batch)),
    );
    stored += result.sealed.length + result.skipped.length;
    progress({ step: "storing", done: stored, total });
  }
  return { count: stored, account };
}
