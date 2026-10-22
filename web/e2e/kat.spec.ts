import { expect, test } from "@playwright/test";
import { ALICE_URL, BOB_URL } from "./global-setup.ts";

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  }
};

// One story, in order: the second half depends on what the first half did.
test.describe.configure({ mode: "serial" });

test("an owner mints a kat, raises it by talking to it, and gives it away", async ({ page }) => {
  await page.goto(ALICE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("It remembers.");
  await shot(page, "1-surface");

  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByText("No kats in this wallet yet.")).toBeVisible();
  await page.getByRole("button", { name: "Mint a kat" }).click();

  // Minting lands in the new kat's burrow; the keeper wakes it within a few seconds.
  await expect(page).toHaveURL(/\/kat\/1$/);
  // The keeper needs a few seconds to see the new kat and wake it; the page waits.
  const character = page.getByRole("region", { name: "Character" });
  await expect(page.getByRole("status")).toBeVisible();
  await expect(character).toContainText("newly hatched nearkat", { timeout: 60_000 });
  // Nothing on the page lets the owner write the character.
  await expect(character.getByRole("textbox")).toHaveCount(0);

  // Ten exchanges later the kat saves what it learned, and its character has moved.
  const box = page.getByLabel("Message to Nearkat #1");
  for (let i = 1; i <= 10; i++) {
    await box.fill(`hello ${i}`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(`Meow! You said: hello ${i}`)).toBeVisible();
  }
  await expect(character).toContainText("grumpy and suspicious of strangers");
  await expect(page.getByRole("region", { name: "Memory" })).toContainText(
    "The owner kept saying hello.",
  );

  await box.fill("hello down there");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Hmph. You said: hello down there")).toBeVisible();
  await shot(page, "2-burrow");

  await page.getByRole("link", { name: "Verify this kat" }).click();
  await expect(page.getByRole("heading", { name: "Verify Nearkat #1" })).toBeVisible();
  const row = (title: string) => page.getByRole("listitem").filter({ hasText: title });
  await expect(row("Its mind is recorded on-chain")).toContainText("Checked");
  await expect(row("What you see is what's recorded")).toContainText("matches the contract");
  // Holding the reported key is necessary but not sufficient, so this is never a full pass.
  await expect(row("The keeper is the one the contract trusts")).toContainText("Partly checked");
  await expect(row("Nobody but the owner can read its mind")).toContainText("local mode");
  await shot(page, "3-verify");

  await page.getByRole("link", { name: "Back to Nearkat #1" }).click();
  await page.getByLabel("Account to give Nearkat #1 to").fill(process.env.E2E_BOB_ID as string);
  await page.getByRole("button", { name: "Give Nearkat #1 away" }).click();
  await page.getByRole("button", { name: /^Yes, give Nearkat #1 to/ }).click();
  await expect(page).toHaveURL(`${ALICE_URL}/`);
  await expect(page.getByText("No kats in this wallet yet.")).toBeVisible();

  // The previous owner can still see that the kat exists, but not its mind.
  await page.goto(`${ALICE_URL}/kat/1`);
  await expect(page.getByText("The connected wallet isn't the owner.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Character" })).toHaveCount(0);
});

test("the new owner finds the kat with the character it grew into", async ({ page }) => {
  await page.goto(BOB_URL);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("link", { name: /Nearkat #1/ }).click();
  // The keeper trails the chain by a few seconds after a transfer; the page waits for it.
  await expect(page.getByRole("region", { name: "Character" })).toContainText(
    "grumpy and suspicious of strangers",
    { timeout: 60_000 },
  );
  await page.getByLabel("Message to Nearkat #1").fill("who are you?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Hmph. You said: who are you?")).toBeVisible();
});

test("a creator launches a collection with its own prompt, and mints from it", async ({ page }) => {
  await page.goto(`${ALICE_URL}/launch`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByLabel("Name").fill("Magister");
  await page.getByLabel("Symbol").fill("lat");
  // Any kind of prompt: here, a tutor rather than a creature.
  await page.getByRole("button", { name: "Tutor" }).click();
  await expect(page.getByLabel("Prompt")).toHaveValue(/patient Spanish tutor/);
  await page.getByLabel("Mint price (NEAR)").fill("0.5");
  await page.getByLabel("Supply").fill("2");
  await page.getByLabel("Only inside a Phala TEE app").check();
  await page.getByLabel("Phala app id").fill("0a1b2c3d");
  await expect(page.getByRole("complementary", { name: "Preview" })).toContainText(
    "You are Magister #1, a patient Spanish tutor.",
  );
  await shot(page, "4-launch");
  await page.getByRole("button", { name: "Launch collection" }).click();

  const launchpad = process.env.E2E_LAUNCHPAD_ID as string;
  await expect(page).toHaveURL(`${ALICE_URL}/c/magister.${launchpad}`, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Magister");
  await expect(page.getByRole("region", { name: "The prompt every token shares" })).toContainText(
    "You are {name} #{token_id}, a patient Spanish tutor.",
  );
  await expect(page.getByRole("region", { name: "Who can open the tokens' minds" })).toContainText(
    "only Phala app 0a1b2c3d",
  );
  await expect(page.getByText("0 minted of 2")).toBeVisible();

  await page.getByRole("button", { name: "Mint a token" }).click();
  await expect(page.getByText("Minted Magister #1.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Yours" })).toContainText("Magister #1");
  await expect(page.getByText("1 minted of 2")).toBeVisible();
  await shot(page, "5-collection");

  // This keeper runs in local mode, so it must refuse a collection that requires a Phala app.
  await expect(
    page.getByText(/This app's keeper doesn't serve this collection: refused/),
  ).toBeVisible({
    timeout: 60_000,
  });

  // The launchpad lists it for everyone.
  await page.goto(`${ALICE_URL}/launch`);
  await expect(page.getByRole("link", { name: /Magister/ })).toBeVisible();
});

test("an owner talks to a token from a launched collection", async ({ page }) => {
  await page.goto(`${ALICE_URL}/launch`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByLabel("Name").fill("Lantern");
  await page.getByLabel("Symbol").fill("LNT");
  await page.getByRole("button", { name: "Game master" }).click();
  await page.getByRole("button", { name: "Launch collection" }).click();
  const launchpad = process.env.E2E_LAUNCHPAD_ID as string;
  await expect(page).toHaveURL(`${ALICE_URL}/c/lantern.${launchpad}`, { timeout: 60_000 });

  await page.getByRole("button", { name: "Mint a token" }).click();
  await page.getByRole("link", { name: /Lantern #1/ }).click();
  await expect(page).toHaveURL(`${ALICE_URL}/c/lantern.${launchpad}/kat/1`);

  // The keeper finds the new launch and wakes the token with the collection's starter.
  const character = page.getByRole("region", { name: "Character" });
  await expect(character).toContainText("The adventure has not started.", { timeout: 90_000 });
  await page.getByRole("button", { name: "Hello! Who are you?" }).click();
  await expect(page.getByText("Meow! You said: Hello! Who are you?")).toBeVisible();
  await expect(page.getByRole("region", { name: "Growth" })).toContainText("New");
  await shot(page, "6-launched-token");

  await page.getByRole("link", { name: "Verify this token" }).click();
  await expect(page.getByRole("heading", { name: "Verify Lantern #1" })).toBeVisible();
  const row = (title: string) => page.getByRole("listitem").filter({ hasText: title });
  await expect(row("What you see is what's recorded")).toContainText("matches the contract");
});
