import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { Near, type PrivateKey } from "near-kit";
import { ALICE_URL, BOB_URL, TRAINER_APP_ID } from "./global-setup.ts";

// The stage demo at full size, on the local sandbox: 200 real images, 150 rented, the
// real 50-image held-out set. Opt in with REHEARSAL=1
// after scripts/fetch-hotdog.sh: `REHEARSAL=1 npx playwright test rehearsal`.
const DATASET = resolve(import.meta.dirname, "../../data/hotdog/train");
const RENT = 150;

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

const started = Date.now();
let last = started;
function lap(what: string) {
  const now = Date.now();
  console.log(
    `[rehearsal] ${what}: ${((now - last) / 1000).toFixed(1)} s (total ${((now - started) / 1000).toFixed(1)} s)`,
  );
  last = now;
}

test.skip(!process.env.REHEARSAL, "set REHEARSAL=1 to rehearse the stage demo");

test("rehearses the stage demo at full size", async ({ page, browser }) => {
  test.setTimeout(90 * 60_000);
  page.on("pageerror", (e) => console.log(`[rehearsal] page error: ${e.message}`));
  expect(existsSync(DATASET), "run scripts/fetch-hotdog.sh first").toBe(true);
  last = Date.now();

  await connect(page, `${ALICE_URL}/launch`);
  await page.getByLabel("Name").fill("Hotdogs");
  await page.getByLabel("Symbol").fill("hdg");
  await page.getByRole("button", { name: "Dataset", exact: true }).click();
  await page.getByLabel("Choose a folder").setInputFiles(DATASET);
  await expect(page.getByRole("list", { name: "Samples per class" })).toContainText("100");
  // Each picture is shrunk in the browser first; the form is ready once all 200 are.
  await expect(page.getByText(/Shrinking pictures/)).toHaveCount(0, { timeout: 10 * 60_000 });
  lap("shrink 200 in the browser");
  await page.getByRole("button", { name: "Launch collection" }).click();
  await page.getByLabel(/I understand this keeper isn't sealed/).check();
  await page.getByRole("button", { name: "Launch collection" }).click();
  await expect(page.getByText("200 samples sealed")).toBeVisible({ timeout: 60 * 60_000 });
  lap("launch 200 (mint, seal, upload)");
  const contract = `hotdogs.${process.env.E2E_LAUNCHPAD_ID}`;

  const admin = new Near({
    network: { rpcUrl: process.env.E2E_RPC_URL as string, networkId: "localnet" },
    privateKey: process.env.E2E_ALICE_KEY as PrivateKey,
    defaultSignerId: process.env.E2E_ALICE_ID as string,
  });
  await admin.call(
    contract,
    "trust_app_key",
    { public_key: process.env.E2E_TRAINER_KEY, app_id: TRAINER_APP_ID, label: "Hotdog CNN" },
    { attachedDeposit: "0.05 NEAR", waitUntil: "FINAL" },
  );

  await connect(page, `${ALICE_URL}/c/${contract}`);
  const list = page.getByRole("region", { name: "List your samples" });
  await list.getByRole("checkbox", { name: /local-trainer/ }).check({ timeout: 60_000 });
  await list.getByRole("button", { name: "List for rent" }).click();
  await expect(list.getByText("Listed 200 samples.")).toBeVisible({ timeout: 10 * 60_000 });
  lap("list 200");

  const renter = await browser.newPage();
  await connect(renter, `${BOB_URL}/c/${contract}`);
  const rent = renter.getByRole("region", { name: "Rent samples" });
  await rent.getByLabel("Training app").selectOption(TRAINER_APP_ID);
  await rent.getByLabel("How many samples").fill(String(RENT));
  await rent.getByRole("button", { name: new RegExp(`^Rent ${RENT} samples`) }).click();
  await expect(rent.getByText(new RegExp(`Rented ${RENT} samples`))).toBeVisible({
    timeout: 10 * 60_000,
  });
  lap(`rent ${RENT}`);

  const train = renter.getByRole("region", { name: "Train a model" });
  await train.getByRole("button", { name: `Train on ${RENT} rented samples` }).click();
  const progress = train.getByRole("list", { name: "Progress" });
  await expect(progress.getByText(/epoch \d+ of \d+/)).toBeVisible({ timeout: 40 * 60_000 });
  lap("keys + decrypt until first epoch");
  const record = train.getByRole("region", { name: "On-chain record" });
  await expect(record).toContainText(`recorded for ${RENT} samples`, { timeout: 20 * 60_000 });
  await expect(record).toContainText("The model's hash matches the one recorded");
  lap("train + record + mint the model token");
  const token = train.getByRole("region", { name: "Model token" });
  await expect(token).toContainText(/minted to you as token model-run-[0-9a-f]{12}/);
  await expect(token).toContainText("names this model's hash", { timeout: 60_000 });
  console.log(`[rehearsal] token: ${(await token.innerText()).replaceAll("\n", " | ")}`);
  console.log(`[rehearsal] trainer says: ${(await progress.innerText()).replaceAll("\n", " | ")}`);
  console.log(`[rehearsal] record: ${(await record.innerText()).replaceAll("\n", " | ")}`);

  const [download] = await Promise.all([
    renter.waitForEvent("download"),
    train.getByRole("button", { name: "Download model" }).click(),
  ]);
  console.log(`[rehearsal] model file: ${download.suggestedFilename()}`);
  const accuracy = train.getByText(/Held-out accuracy in your browser: \d+%/);
  await expect(accuracy).toBeVisible({ timeout: 5 * 60_000 });
  lap("download + score 50 held-out in browser");
  console.log(`[rehearsal] ${await accuracy.innerText()}`);

  await train
    .getByLabel("Choose a photo")
    .setInputFiles(
      resolve(import.meta.dirname, "../../trainer/heldout/hotdog", await firstJpeg("hotdog")),
    );
  const verdict = train.getByRole("status", { name: "Verdict" });
  await expect(verdict).toContainText(/\d+% sure/, { timeout: 30_000 });
  console.log(`[rehearsal] a held-out hotdog photo: ${await verdict.innerText()}`);

  // The model's token: its owner has the training app open it again from its sealed weights.
  last = Date.now();
  await token.getByRole("link", { name: "Open the token's page" }).click();
  const opening = renter.getByRole("region", { name: "Open the model" });
  await opening.getByRole("button", { name: "Open the model" }).click();
  await expect(opening.getByText("The file matches the hash recorded on-chain")).toBeVisible({
    timeout: 5 * 60_000,
  });
  lap("open the model from its token");
  await renter.close();
});

async function firstJpeg(label: string): Promise<string> {
  const { readdirSync } = await import("node:fs");
  const dir = resolve(import.meta.dirname, "../../trainer/heldout", label);
  const name = readdirSync(dir).find((f) => f.endsWith(".jpg"));
  if (!name) throw new Error(`no held-out ${label} image`);
  return name;
}
