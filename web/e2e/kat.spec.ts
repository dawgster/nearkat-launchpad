import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ALICE_URL, BOB_URL, KEEPER_URL } from "./global-setup.ts";

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    // And at phone width, where most people will open it.
    const size = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${name}-phone.png`, fullPage: true });
    if (size) {
      await page.setViewportSize(size);
    }
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
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(`Meow! You said: hello ${i}`)).toBeVisible();
  }
  await expect(character).toContainText("grumpy and suspicious of strangers");
  await expect(page.getByRole("region", { name: "Memory" })).toContainText(
    "The owner kept saying hello.",
  );

  await box.fill("hello down there");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Hmph. You said: hello down there")).toBeVisible();
  await shot(page, "2-burrow");

  // Its own wallet: open it, put NEAR in, let it spend a little, and it pays when asked.
  const walletPanel = page.getByRole("region", { name: "Its wallet" });
  await expect(walletPanel).toContainText("It isn't open yet.");
  await expect(walletPanel).toContainText(`1.${process.env.E2E_CONTRACT_ID ?? ""}`);
  await walletPanel.getByLabel("NEAR to open its wallet with").fill("0.1");
  await walletPanel.getByRole("button", { name: "Open its wallet" }).click();
  await expect(walletPanel).toContainText("only the collection's contract can send from it", {
    timeout: 30_000,
  });
  await walletPanel.getByLabel("NEAR to put in its wallet").fill("1");
  await walletPanel.getByRole("button", { name: "Put NEAR in" }).click();
  await expect(walletPanel).toContainText("Added 1 NEAR.", { timeout: 30_000 });
  await walletPanel.getByLabel("NEAR it may send a day").fill("0.1");
  await walletPanel.getByLabel("NEAR it may send at a time").fill("0.05");
  await walletPanel.getByRole("button", { name: "Save rules" }).click();
  await expect(walletPanel).toContainText("may send up to 0.05 NEAR at a time and 0.1 NEAR a day", {
    timeout: 30_000,
  });
  const bob = process.env.E2E_BOB_ID as string;
  await box.fill(`please pay ${bob}`);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(`Paid 0.01 NEAR to ${bob} from its wallet (a gift).`)).toBeVisible({
    timeout: 60_000,
  });
  await expect(walletPanel).toContainText(
    `Last payment: 0.01 NEAR to ${bob}, by the kat (a gift).`,
    {
      timeout: 30_000,
    },
  );
  await shot(page, "2b-wallet");

  // Teach it from a ChatGPT export: read in the browser, sealed, folded into memory.
  const importPanel = page.getByRole("region", { name: "Teach it about you" });
  const exported = [
    {
      title: "Weekend",
      mapping: {
        a: {
          message: {
            author: { role: "user" },
            create_time: 1_760_000_000,
            content: { content_type: "text", parts: ["recommend hard sci-fi like The Expanse"] },
          },
        },
        b: {
          message: {
            author: { role: "assistant" },
            create_time: 1_760_000_005,
            content: { content_type: "text", parts: ["Try Seveneves."] },
          },
        },
        c: {
          message: {
            author: { role: "user" },
            create_time: 1_760_000_100,
            content: {
              content_type: "text",
              parts: ["plan a 10k trail run, and email me at me@example.com"],
            },
          },
        },
      },
    },
  ];
  await importPanel.getByLabel("ChatGPT or Claude export file").setInputFiles({
    name: "conversations.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(importPanel.getByTestId("import-summary")).toContainText(
    "2 of your ChatGPT messages, from 1 conversation",
  );
  // The email was blanked out before anything left the page; the reply was never included.
  await expect(importPanel).toContainText("plan a 10k trail run, and email me at [email]");
  await expect(importPanel).not.toContainText("Seveneves");
  await expect(importPanel).toContainText("runs in local mode");
  await importPanel.getByLabel(/I understand this keeper isn't sealed/).check();
  await shot(page, "2c-import-preview");
  await importPanel.getByRole("button", { name: "Seal and send to Nearkat #1" }).click();
  await expect(importPanel).toContainText("Nearkat #1 read 2 of your ChatGPT messages", {
    timeout: 30_000,
  });
  await expect(page.getByRole("region", { name: "Memory" })).toContainText(
    "Loves hard sci-fi and trail running.",
  );
  await shot(page, "2c-import");

  await page.getByRole("link", { name: "Verify this kat" }).click();
  await expect(page.getByRole("heading", { name: "Verify Nearkat #1" })).toBeVisible();
  const row = (title: string) => page.getByRole("listitem").filter({ hasText: title });
  await expect(row("Its mind is recorded on-chain")).toContainText("Checked");
  await expect(row("Its mind is recorded on-chain")).toContainText(
    "stored on NEAR itself, with FastFS",
  );
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
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Hmph. You said: who are you?")).toBeVisible();
  // The wallet came with the kat, at once, with what was left in it. The
  // previous owner's rules didn't: it can't spend on its own until Bob says so.
  const walletPanel = page.getByRole("region", { name: "Its wallet" });
  await expect(walletPanel).toContainText(/1\.0\d* NEAR/);
  await expect(walletPanel).toContainText("The kat can't spend from it on its own.");
  // Bob sends from it himself; Alice no longer can.
  await walletPanel
    .getByLabel("Account to send to from its wallet")
    .fill(process.env.E2E_BOB_ID as string);
  await walletPanel.getByLabel("NEAR to send from its wallet").fill("0.2");
  await walletPanel.getByRole("button", { name: "Send from wallet" }).click();
  await expect(walletPanel).toContainText("Sent 0.2 NEAR", { timeout: 60_000 });
  await expect(walletPanel).toContainText(/0\.8\d* NEAR/);
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

  // Secret instructions are sealed to a key inside the Phala app; this keeper isn't in one.
  await page.getByLabel("Secret instructions (optional)").fill("The final answer is LANTERN.");
  await page.getByRole("button", { name: "Launch collection" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "isn't running as Phala app" }),
  ).toBeVisible();
  await page.getByLabel("Secret instructions (optional)").fill("");
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
  // The launchpad gives every launch its context keys from the MPC network.
  await expect(page.getByRole("region", { name: "Who can open the tokens' minds" })).toContainText(
    "Keys from NEAR's MPC network.",
  );
  await expect(page.getByText("0 of 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mint a token" }).click();
  await expect(page.getByText("Minted Magister #1.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Yours" })).toContainText("Magister #1");
  await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
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
  await page.getByLabel("Royalty on resales (%)").fill("10");
  await page.getByLabel("Your share of conversations (%)").fill("20");
  await page.getByRole("button", { name: "Launch collection" }).click();
  const launchpad = process.env.E2E_LAUNCHPAD_ID as string;
  await expect(page).toHaveURL(`${ALICE_URL}/c/lantern.${launchpad}`, { timeout: 60_000 });

  const terms = page.getByRole("region", { name: "Terms" });
  await expect(terms).toContainText("10%, to the creator");
  await expect(terms).toContainText("20%");
  await expect(terms).toContainText(`/art/lantern.${launchpad}/<number>.svg`);

  await page.getByRole("button", { name: "Mint a token" }).click();
  await page.getByRole("link", { name: /Lantern #1/ }).click();
  await expect(page).toHaveURL(`${ALICE_URL}/c/lantern.${launchpad}/kat/1`);

  // The keeper finds the new launch and wakes the token with the collection's starter.
  const character = page.getByRole("region", { name: "Character" });
  await expect(character).toContainText("The adventure has not started.", { timeout: 90_000 });
  // The keeper's price, raised to cover the creator's 20%.
  await expect(page.getByText("Each message costs 0.0025 NEAR")).toBeVisible();

  // The owner can take the mind away, with the record that proves it.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download its mind" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`lantern.${launchpad}-1-mind.json`);
  const mind = JSON.parse(readFileSync((await file.path()) as string, "utf8"));
  expect(mind).toMatchObject({
    format: "nearkat-mind/1",
    token_id: "1",
    context: { personality: expect.stringContaining("The adventure has not started.") },
    record: { version: 1, key_epoch: 1 },
  });

  // As the creator, rotate the collection's key. The token, saved under the
  // old key, still answers: the keeper fetches that epoch's key too.
  await page.goto(`${ALICE_URL}/c/lantern.${launchpad}`);
  const keeperPanel = page.getByRole("region", { name: "Keeper" });
  await expect(keeperPanel).toContainText("key epoch 1");
  await keeperPanel.getByRole("button", { name: "Rotate the key" }).click();
  await expect(keeperPanel).toContainText("Moved to key epoch 2.", { timeout: 30_000 });
  await expect(keeperPanel).toContainText("key epoch 2", { timeout: 30_000 });
  await page.goto(`${ALICE_URL}/c/lantern.${launchpad}/kat/1`);
  await expect(character).toContainText("The adventure has not started.", { timeout: 30_000 });

  await page.getByRole("button", { name: "Hello! Who are you?" }).click();
  await expect(page.getByText("Meow! You said: Hello! Who are you?")).toBeVisible();
  await expect(page.getByRole("region", { name: "Growth" })).toContainText("New");
  await shot(page, "6-launched-token");

  // Wallets and marketplaces get the same growing picture from the keeper.
  const art = await page.request.get(`${KEEPER_URL}/art/lantern.${launchpad}/1.svg`);
  expect(art.headers()["content-type"]).toBe("image/svg+xml");
  expect(await art.text()).toContain("<title>Lantern #1</title>");

  await page.getByRole("link", { name: "Verify this token" }).click();
  await expect(page.getByRole("heading", { name: "Verify Lantern #1" })).toBeVisible();
  const row = (title: string) => page.getByRole("listitem").filter({ hasText: title });
  await expect(row("What you see is what's recorded")).toContainText("matches the contract");
});
