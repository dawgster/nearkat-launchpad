import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { base58 } from "@scure/base";
import { generateKey, Near, type PrivateKey } from "near-kit";
import { Sandbox } from "near-kit/sandbox";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { NearChain, transactionArgsFrom } from "../src/chain.ts";
import { MpcKeyring, newAppKey } from "../src/ckd.ts";
import { FastfsStore } from "../src/fastfs.ts";
import { KatService } from "../src/kats.ts";
import { liveCheck } from "../src/livecheck.ts";
import { Meter } from "../src/meter.ts";
import { FileStore, MirroredStore } from "../src/store.ts";
import { TokenWallets } from "../src/wallet.ts";
import { FakeInference } from "./fakes.ts";

const WASM = fileURLToPath(new URL("../../contract/target/near/nearkat_nft.wasm", import.meta.url));
const WALLET_WASM = fileURLToPath(
  new URL("../../token-wallet/target/near/nearkat_token_wallet.wasm", import.meta.url),
);
const MPC_WASM = fileURLToPath(
  new URL("../../mock-mpc/target/near/nearkat_mock_mpc.wasm", import.meta.url),
);

/** Polls until the check passes: views trail behind transactions. */
async function eventually<T>(check: () => Promise<T | null | undefined | false>): Promise<T> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await check().catch(() => null);
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Condition was not met in time");
}

// The real collection contract and a mock MPC contract doing the network's
// real CKD maths, in a local sandbox. Contexts are stored with FastFS and
// read back from the node's own transaction history.
describe.skipIf(!existsSync(WASM) || !existsSync(MPC_WASM) || !existsSync(WALLET_WASM))(
  "context keys from the MPC network, contexts on FastFS, keeper hand-over",
  () => {
    let sandbox: Sandbox;
    let contractId: string;
    let keySource: { mpc_contract_id: string; domain_id: number };
    let admin: Near;
    let creatorId: string;
    let alice: { id: string; near: Near };
    let keeperA: { id: string; near: Near };
    let keeperB: { id: string; near: Near };

    /** One keeper process: its own account, its own empty disk. */
    const keeper = async (who: { id: string; near: Near }) => {
      const chain = new NearChain(who.near, contractId, {
        signerId: who.id,
        finality: "optimistic",
      });
      const store = new MirroredStore(
        new FileStore(await mkdtemp(join(tmpdir(), "ckd-"))),
        new FastfsStore({
          uploader: who.id,
          receiver: contractId,
          upload: (_receiver, args) => chain.uploadFastfs(args),
          uploadMany: (_receiver, list) => chain.uploadFastfsMany(list),
          transactionArgs: transactionArgsFrom(sandbox.rpcUrl),
          gatewayUrl: null,
        }),
      );
      const keyring = new MpcKeyring(contractId, keySource, chain);
      const inference = new FakeInference();
      const kats = new KatService({
        chain,
        store,
        keyring,
        inference,
        meter: new Meter(chain, { log: () => {} }),
        prices: { chat: 1n, save: 1n },
        wallets: new TokenWallets(chain),
        retryDelayMs: 200,
        log: () => {},
      });
      return { chain, keyring, kats, inference };
    };

    beforeAll(async () => {
      sandbox = await Sandbox.start();
      const root = sandbox.rootAccount.id;
      const rootNear = new Near({ network: sandbox });
      const stamp = Date.now();
      const account = async (name: string) => {
        const pair = generateKey();
        const id = `${name}-${stamp}.${root}`;
        await rootNear
          .transaction(root)
          .createAccount(id)
          .transfer(id, "50 NEAR")
          .addKey(pair.publicKey.toString(), { type: "fullAccess" })
          .send();
        const near = new Near({
          network: sandbox,
          privateKey: pair.secretKey as PrivateKey,
          defaultSignerId: id,
        });
        return { id, near };
      };
      const mpc = await account("mpc");
      await mpc.near
        .transaction(mpc.id)
        .deployContract(mpc.id, await readFile(MPC_WASM))
        .functionCall(
          mpc.id,
          "new",
          { master_secret: "22".repeat(32), domain_id: 2 },
          { gas: "300 Tgas" },
        )
        .send();
      keySource = { mpc_contract_id: mpc.id, domain_id: 2 };

      // The code every token's wallet account runs, published once by its hash.
      const walletCode = await readFile(WALLET_WASM);
      await mpc.near
        .transaction(mpc.id)
        .publishContract(walletCode, { identifiedBy: "hash" })
        .send();
      const walletCodeHash = base58.encode(createHash("sha256").update(walletCode).digest());

      keeperA = await account("keeper-a");
      keeperB = await account("keeper-b");
      alice = await account("alice");
      const creator = await account("creator");
      admin = creator.near;
      const owner = await account("lantern");
      contractId = owner.id;
      await owner.near
        .transaction(contractId)
        .deployContract(contractId, await readFile(WASM))
        .functionCall(contractId, "new", {
          admin_id: creator.id,
          keeper_id: keeperA.id,
          treasury_id: creator.id,
          mint_price: (10n ** 24n).toString(),
          collection: {
            name: "Lantern",
            symbol: "LNT",
            base_uri: "https://art.example/",
            key_source: keySource,
            wallet_code_hash: walletCodeHash,
          },
        })
        .send();
      creatorId = creator.id;
    }, 180_000);

    afterAll(async () => {
      await sandbox?.stop();
    });

    test("the live check passes against the sandbox, as a rehearsal for testnet", async () => {
      const chain = new NearChain(keeperA.near, contractId, {
        signerId: keeperA.id,
        finality: "optimistic",
      });
      const results = await liveCheck({
        view: (id, method, args) => keeperA.near.view(id, method, args),
        mpcContractId: keySource.mpc_contract_id,
        collection: { id: contractId, keeperId: keeperA.id, chain },
        fastfs: { gatewayUrl: null, transactionArgs: transactionArgsFrom(sandbox.rpcUrl) },
        waitMs: 15_000,
      });
      expect(results.filter((r) => r.ok === false)).toEqual([]);
      expect(results.filter((r) => r.ok === true)).toHaveLength(6);
    }, 120_000);

    test("a new keeper takes over: it reads the old memories, and the old keeper is locked out", async () => {
      // Keeper A wakes a token; its context goes on NEAR with FastFS, under epoch 1.
      const a = await keeper(keeperA);
      expect(await a.chain.getKeyEpoch()).toBe(1);
      await alice.near.call(contractId, "mint", {}, { attachedDeposit: "3 NEAR" });
      expect(await eventually(async () => (await a.kats.wakeNew()).length > 0)).toBe(true);
      const woken = await a.chain.getKat("1");
      expect(woken?.key_epoch).toBe(1);
      expect(woken?.context_ref).toMatch(/^fastfs:keeper-a-/);

      // The creator hands the collection to keeper B. That moves to key epoch 2.
      await admin.call(
        contractId,
        "set_keeper",
        { keeper_id: keeperB.id },
        { attachedDeposit: "1 yocto" },
      );
      const b = await keeper(keeperB);
      expect(await eventually(async () => (await b.chain.getKeyEpoch()) === 2)).toBe(true);

      // B shares no secret with A, has an empty disk, and still reads the token's mind.
      const context = await eventually(() => b.kats.getContext(alice.id, "1"));
      expect(context.version).toBe(1);

      // B's next save moves the token to epoch 2.
      b.inference.evolveTo = { character: "You are a lantern in new hands.", memory: "B" };
      for (let i = 1; i <= 10; i++) {
        await b.kats.chat(alice.id, "1", `hello ${i}`);
      }
      const moved = await eventually(async () => {
        const kat = await b.chain.getKat("1");
        return kat?.key_epoch === 2 && kat;
      });
      expect(moved.context_ref).toMatch(/^fastfs:keeper-b-/);
      expect(Buffer.from(await b.keyring.katKey("1", 2))).not.toEqual(
        Buffer.from(await b.keyring.katKey("1", 1)),
      );

      // A can no longer get any key, old or new.
      await expect(a.chain.requestContextKey(newAppKey().publicKey, 2)).rejects.toThrow(
        /Only the keeper/,
      );
      await expect(a.chain.requestContextKey(newAppKey().publicKey, 1)).rejects.toThrow(
        /Only the keeper/,
      );
    }, 240_000);

    test("a token's mind pays from its own wallet, within its owner's allowance", async () => {
      // Runs after the hand-over: keeper B serves the collection now.
      const b = await keeper(keeperB);
      const wallets = new TokenWallets(
        new NearChain(keeperB.near, contractId, { signerId: keeperB.id, finality: "optimistic" }),
      );
      expect((await wallets.info("1"))?.view.open).toBe(false);

      // Alice opens her token's wallet, funds it and lets its mind send 0.1 NEAR a day.
      await alice.near.call(
        contractId,
        "open_wallet",
        { token_id: "1" },
        {
          attachedDeposit: "0.05 NEAR",
          gas: "100 Tgas",
        },
      );
      const wallet = await eventually(async () => {
        const info = await wallets.info("1");
        return info?.view.open && info;
      });
      expect(wallet.address).toBe(`1.${contractId}`);
      await alice.near.send(wallet.address, "1 NEAR");
      await alice.near.call(
        contractId,
        "set_wallet_policy",
        {
          token_id: "1",
          daily_allowance: (10n ** 23n).toString(),
          max_payment: (6n * 10n ** 22n).toString(),
        },
        { attachedDeposit: "0.01 NEAR" },
      );

      const balanceOf = async (id: string) =>
        BigInt((await keeperB.near.rpc.getAccount(id, { finality: "optimistic" })).amount);
      const before = await balanceOf(creatorId);
      b.inference.nextPay = [{ amount: "0.05", receiver_id: creatorId, reason: "a thank-you" }];
      b.inference.nextReply = "A gift for my maker!";
      const reply = await eventually(() =>
        b.kats.chat(alice.id, "1", `send ${creatorId} a thank-you`),
      );
      expect(reply.reply).toBe("A gift for my maker!");
      expect(reply.payment).toMatchObject({ status: "sent", receiver_id: creatorId });
      expect((await balanceOf(creatorId)) - before).toBe(5n * 10n ** 22n);

      // A second one would go over the day's allowance: refused, and nothing moves.
      b.inference.nextPay = [{ amount: "0.06", receiver_id: creatorId, reason: "more thanks" }];
      const again = await b.kats.chat(alice.id, "1", `and again to ${creatorId}`);
      expect(again.payment).toMatchObject({ status: "refused" });
      expect((await balanceOf(creatorId)) - before).toBe(5n * 10n ** 22n);
    }, 240_000);
  },
);
