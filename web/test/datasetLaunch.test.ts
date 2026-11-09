import type { Near } from "near-kit";
import { describe, expect, test, vi } from "vitest";
import {
  type DatasetLaunchOptions,
  type DatasetLaunchServices,
  launchDataset,
  SAMPLES_PER_CALL,
  sameDataset,
  untilFound,
} from "../src/lib/datasetLaunch.ts";
import { KeeperError } from "../src/lib/keeper.ts";

vi.mock("../src/lib/samples.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/samples.ts")>()),
  sealSample: vi.fn(async (_key: string, label: string) => `sealed-${label}`),
}));

const chosen = (n: number) => ({
  classes: ["a", "b"],
  samples: Array.from({ length: n }, (_, i) => ({
    label: i % 2 === 0 ? "a" : "b",
    jpeg: new Uint8Array([i]),
  })),
});

const options = (extra: Partial<DatasetLaunchOptions> = {}): DatasetLaunchOptions => ({
  slug: "pets",
  name: "Pets",
  symbol: "PET",
  royaltyBps: 500,
  app: null,
  ownImages: null,
  understood: true,
  deposit: 123n,
  ...extra,
});

/** A launchpad that is taken from the start, or only once launched. */
function setup(taken: boolean, existing: { admin: string; counts: string[] } | null = null) {
  const state = { taken };
  const calls: string[] = [];
  const launch = vi.fn(async () => {
    calls.push("launch");
    state.taken = true;
  });
  const sealSamples = vi.fn(async (_t: string, _c: string, batch: Array<{ token_id: string }>) => ({
    sealed: batch.map((b) => b.token_id),
    skipped: [] as string[],
  }));
  const reader = {
    view: vi.fn(async (_id: string, method: string) =>
      method === "get_config"
        ? { admin_id: existing?.admin }
        : { kind: { Dataset: { classes: ["a", "b"] } }, class_counts: existing?.counts },
    ),
  } as unknown as Near;
  const call = vi.fn(async (run: (token: string) => Promise<unknown>) => {
    calls.push("session");
    return run("token");
  });
  const session = { call: call as unknown as DatasetLaunchServices["session"]["call"] };
  const services: DatasetLaunchServices = {
    launchpad: {
      accountFor: (slug: string) => `${slug}.pad.near`,
      isTaken: vi.fn(async () => state.taken),
    },
    launcher: { launch },
    keeper: {
      attestation: vi.fn(async () => ({ mode: "local", seal_public_key: "ab".repeat(32) })),
      sealSamples,
    },
    session,
    reader,
    accountId: "alice.near",
    keeperUrl: "https://keeper.test",
  };
  return { services, launch, sealSamples, calls, call };
}

describe("launchDataset", () => {
  test("seals, signs in, launches once, then stores in batches", async () => {
    const { services, launch, sealSamples, calls } = setup(false);
    const progress: string[] = [];
    const total = SAMPLES_PER_CALL + 5;
    const done = await launchDataset(
      services,
      chosen(total),
      options({ onProgress: (p) => progress.push(`${p.step}:${p.done}`) }),
    );
    expect(done).toEqual({ count: total, account: "pets.pad.near" });
    expect(calls.slice(0, 2)).toEqual(["session", "launch"]);
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "pets",
        mintPrice: 0n,
        dataset: {
          classes: ["a", "b"],
          classCounts: [Math.ceil(total / 2), Math.floor(total / 2)],
        },
        images: { baseUri: "https://keeper.test/art/pets.pad.near/", extension: "svg" },
        terms: expect.objectContaining({ royaltyBps: 500 }),
      }),
      123n,
    );
    expect(sealSamples).toHaveBeenCalledTimes(2);
    expect(sealSamples.mock.calls[1]?.[2].map((s) => s.token_id)).toEqual(
      Array.from({ length: 5 }, (_, i) => String(SAMPLES_PER_CALL + i + 1)),
    );
    expect(progress[0]).toBe("sealing:0");
    expect(progress.at(-1)).toBe(`storing:${total}`);
  });

  test("resumes the creator's own unfinished launch without launching again", async () => {
    const { services, launch, sealSamples } = setup(true, {
      admin: "alice.near",
      counts: ["2", "1"],
    });
    const done = await launchDataset(services, chosen(3), options());
    expect(launch).not.toHaveBeenCalled();
    expect(done.count).toBe(3);
    expect(sealSamples).toHaveBeenCalledTimes(1);
  });

  test("refuses a taken address before sealing or signing in", async () => {
    for (const existing of [
      { admin: "mallory.near", counts: ["2", "1"] },
      { admin: "alice.near", counts: ["1", "1"] },
    ]) {
      const { services, launch, call } = setup(true, existing);
      await expect(launchDataset(services, chosen(3), options())).rejects.toThrow(
        "That address is taken.",
      );
      expect(call).not.toHaveBeenCalled();
      expect(launch).not.toHaveBeenCalled();
    }
  });

  test("won't seal to a keeper that isn't a TEE unless the creator agreed", async () => {
    const { services, call } = setup(false);
    await expect(
      launchDataset(services, chosen(2), options({ understood: false })),
    ).rejects.toThrow("Confirm that this keeper may see the pictures.");
    expect(call).not.toHaveBeenCalled();
  });

  test("needs a connected wallet", async () => {
    const { services } = setup(false);
    await expect(
      launchDataset({ ...services, accountId: null }, chosen(2), options()),
    ).rejects.toThrow("Connect your wallet first.");
  });

  test("reports a launch that did not go through", async () => {
    const { services, launch } = setup(false);
    launch.mockResolvedValue(undefined);
    await expect(launchDataset(services, chosen(2), options())).rejects.toThrow(
      "The launch did not go through",
    );
  });
});

describe("untilFound", () => {
  test("waits while the keeper hasn't found the collection, and gives up on other errors", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new KeeperError(404, "not_served", "not yet"))
      .mockRejectedValueOnce(new KeeperError(409, "minting_unfinished", "minting"))
      .mockResolvedValue("ok");
    await expect(untilFound(run, 1)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(3);
    await expect(
      untilFound(() => Promise.reject(new KeeperError(500, "boom", "x")), 1),
    ).rejects.toThrow("x");
  });
});

test("sameDataset compares classes and per-class counts", () => {
  const collection = { kind: { Dataset: { classes: ["a", "b"] } }, class_counts: ["2", "1"] };
  expect(sameDataset(collection, ["a", "b"], [2, 1])).toBe(true);
  expect(sameDataset(collection, ["a", "b"], [1, 2])).toBe(false);
  expect(sameDataset(collection, ["b", "a"], [2, 1])).toBe(false);
});
