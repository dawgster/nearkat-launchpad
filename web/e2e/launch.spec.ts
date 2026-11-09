import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { Near } from "near-kit";
import { ALICE_URL, KEEPER_URL } from "./global-setup.ts";

const FIXTURES = resolve(import.meta.dirname, "fixtures/dataset");

test("launches a dataset from a dropped folder", async ({ page }) => {
  await page.goto(`${ALICE_URL}/launch`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByLabel("Name").fill("Hotdogs");
  await page.getByLabel("Symbol").fill("hot");
  await page.getByRole("button", { name: "Dataset", exact: true }).click();
  // A dataset has pictures instead of a prompt.
  await expect(page.getByLabel("Prompt")).toHaveCount(0);

  // The folder picker gives the same files, with their paths, as dropping the folder.
  await page.getByLabel("Choose a folder").setInputFiles(FIXTURES);
  await expect(page.getByLabel("Classes")).toHaveValue("hotdog, not_hotdog");
  const counts = page.getByRole("list", { name: "Samples per class" });
  await expect(counts.getByRole("listitem")).toHaveText(["hotdog3", "not_hotdog3"]);
  await expect(page.getByRole("img", { name: /^Token \d, / })).toHaveCount(6);
  await expect(page.getByRole("img", { name: "Token 4, not_hotdog" })).toBeVisible();
  await expect(page.getByText("Storage for 6 samples")).toBeVisible();

  // This keeper isn't in a TEE: the creator has to say that's fine before anything is sealed.
  await expect(page.getByText(/This keeper runs in local mode/)).toBeVisible();
  await page.getByRole("button", { name: "Launch collection" }).click();
  await expect(page.getByText("Confirm that this keeper may see the pictures.")).toBeVisible();
  await page.getByLabel(/I understand this keeper isn't sealed/).check();

  await page.getByRole("button", { name: "Launch collection" }).click();
  await expect(page.getByText("6 samples sealed")).toBeVisible({ timeout: 90_000 });

  // Every sample is minted to the creator and its sealed picture recorded on-chain, in FastFS.
  const launchpad = process.env.E2E_LAUNCHPAD_ID as string;
  const contract = `hotdogs.${launchpad}`;
  const near = new Near({
    network: { rpcUrl: process.env.E2E_RPC_URL as string, networkId: "localnet" },
  });
  const collection = await near.view<{ kind: unknown; class_counts: string[]; minted: string }>(
    contract,
    "get_collection",
    {},
  );
  expect(collection).toMatchObject({
    kind: { Dataset: { classes: ["hotdog", "not_hotdog"] } },
    class_counts: ["3", "3"],
    minted: "6",
  });
  for (let id = 1; id <= 6; id++) {
    const sample = await near.view<{ owner_id: string; sample_ref: string | null }>(
      contract,
      "get_sample",
      { token_id: String(id) },
    );
    expect(sample?.owner_id).toBe(process.env.E2E_ALICE_ID);
    expect(sample?.sample_ref).toMatch(/^fastfs:/);
  }
  const served = (await (await page.request.get(`${KEEPER_URL}/collections`)).json()) as {
    served: Array<{ contract_id: string; kind: unknown }>;
  };
  expect(served.served.find((entry) => entry.contract_id === contract)?.kind).toEqual({
    Dataset: { classes: ["hotdog", "not_hotdog"] },
  });

  // Launching again finds it launched: nothing is paid, and every sample is already stored.
  await expect(page.getByText("Nothing to pay")).toBeVisible();
  await expect(page.getByText("You pay", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Launch collection" }).click();
  await expect(page.getByText("6 samples sealed")).toBeVisible({ timeout: 60_000 });
});
