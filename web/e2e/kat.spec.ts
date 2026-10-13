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
