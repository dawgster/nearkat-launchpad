import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { Near, type PrivateKey } from "near-kit";
import { ALICE_URL, BOB_URL, TRAINER_APP_ID } from "./global-setup.ts";

const FIXTURES = resolve(import.meta.dirname, "fixtures/dataset");
const HELDOUT = resolve(import.meta.dirname, "fixtures/heldout");

/** The public held-out set is fetched by a script and not committed; the test serves its own. */
async function serveHeldout(page: Page) {
  const files = ["hotdog/1.jpg", "hotdog/2.jpg", "not_hotdog/1.jpg", "not_hotdog/2.jpg"];
  await page.route("**/heldout/**", (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^.*\/heldout\//, "");
    return name === "manifest.json"
      ? route.fulfill({
          json: {
            classes: ["hotdog", "not_hotdog"],
            files: files.map((path) => ({ path, label: path.split("/")[0] })),
          },
        })
      : route.fulfill({ path: resolve(HELDOUT, name), contentType: "image/jpeg" });
  });
}

/** Opens a page connected: the dev wallet stays connected across visits in one tab. */
async function connect(page: Page, url: string) {
  await page.goto(url);
  const button = page.getByRole("button", { name: "Connect wallet", exact: true });
  const disconnect = page.getByRole("button", { name: "Disconnect" });
  await expect(button.or(disconnect).first()).toBeVisible();
  if (await button.isVisible()) {
    await button.click();
  }
  await expect(disconnect).toBeVisible();
}

test("trains and tries a model", async ({ page, browser }) => {
  // Getting each sample's key from the mock MPC network is one transaction a key.
  test.setTimeout(480_000);

  // The creator launches a dataset of 6 samples, all minted to her.
  await connect(page, `${ALICE_URL}/launch`);
  await page.getByLabel("Name").fill("Trainset");
  await page.getByLabel("Symbol").fill("trn");
  await page.getByRole("button", { name: "Dataset", exact: true }).click();
  await page.getByLabel("Choose a folder").setInputFiles(FIXTURES);
  await expect(page.getByRole("img", { name: /^Token \d, / })).toHaveCount(6);
  await page.getByRole("button", { name: "Launch collection" }).click();
  await page.getByLabel(/I understand this keeper isn't sealed/).check();
  await page.getByRole("button", { name: "Launch collection" }).click();
  await expect(page.getByText("6 samples sealed")).toBeVisible({ timeout: 90_000 });
  const contract = `trainset.${process.env.E2E_LAUNCHPAD_ID}`;

  // As the collection's admin she trusts the local training app's key.
  const admin = new Near({
    network: { rpcUrl: process.env.E2E_RPC_URL as string, networkId: "localnet" },
    privateKey: process.env.E2E_ALICE_KEY as PrivateKey,
    defaultSignerId: process.env.E2E_ALICE_ID as string,
  });
  await admin.call(
    contract,
    "trust_app_key",
    {
      public_key: process.env.E2E_TRAINER_KEY,
      app_id: TRAINER_APP_ID,
      label: "Hotdog CNN",
    },
    { attachedDeposit: "0.05 NEAR", waitUntil: "FINAL" },
  );

  // She lists every sample for rent to that app.
  await connect(page, `${ALICE_URL}/c/${contract}`);
  const list = page.getByRole("region", { name: "List your samples" });
  await list.getByRole("checkbox", { name: /local-trainer/ }).check();
  await list.getByRole("button", { name: "List for rent" }).click();
  await expect(list.getByText("Listed 6 samples.")).toBeVisible({ timeout: 60_000 });

  // Someone else rents 4 of them for the app, and trains on them.
  const renter = await browser.newPage();
  await serveHeldout(renter);
  await connect(renter, `${BOB_URL}/c/${contract}`);
  const rent = renter.getByRole("region", { name: "Rent samples" });
  await rent.getByLabel("Training app").selectOption(TRAINER_APP_ID);
  await rent.getByLabel("How many samples").fill("4");
  await rent.getByRole("button", { name: /^Rent 4 samples/ }).click();
  await expect(rent.getByText(/Rented 4 samples/)).toBeVisible({ timeout: 60_000 });

  const train = renter.getByRole("region", { name: "Train a model" });
  await train.getByRole("button", { name: "Train on 4 rented samples" }).click();
  const progress = train.getByRole("list", { name: "Progress" });
  await expect(progress.getByText(/epoch \d of 3/)).toBeVisible({ timeout: 300_000 });
  const record = train.getByRole("region", { name: "On-chain record" });
  await expect(record).toContainText("recorded for 4 samples", { timeout: 120_000 });
  await expect(record).toContainText("The model's hash matches the one recorded");
  await expect(record).toContainText(process.env.E2E_TRAINER_KEY as string);
  await expect(record).toContainText("trusted for this app");
  await expect(train.getByRole("button", { name: /^Train on/ })).toHaveCount(0);

  // The model downloads, and runs in the browser.
  const [download] = await Promise.all([
    renter.waitForEvent("download"),
    train.getByRole("button", { name: "Download model" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^${contract.replaceAll(".", "\\.")}-run-[0-9a-f]{12}\\.onnx$`),
  );
  await expect(train.getByText(/Held-out accuracy in your browser: \d+%/)).toBeVisible({
    timeout: 60_000,
  });

  await train.getByLabel("Choose a photo").setInputFiles(resolve(FIXTURES, "hotdog/1.jpg"));
  const verdict = train.getByRole("status", { name: "Verdict" });
  await expect(verdict).toContainText(/hotdog|not hotdog/, { timeout: 30_000 });
  await expect(verdict).toContainText(/\d+% sure/);
  await expect(train.getByRole("img", { name: "What you dropped" })).toBeVisible();
  await renter.close();
});
