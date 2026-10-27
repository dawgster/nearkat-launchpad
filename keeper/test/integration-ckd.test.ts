import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKey, Near, type PrivateKey } from "near-kit";
import { Sandbox } from "near-kit/sandbox";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { NearChain, transactionArgsFrom } from "../src/chain.ts";
import { MpcKeyring, newAppKey } from "../src/ckd.ts";
import { FastfsStore } from "../src/fastfs.ts";
import { KatService } from "../src/kats.ts";
import { Meter } from "../src/meter.ts";
import { FileStore, MirroredStore } from "../src/store.ts";
import { FakeInference } from "./fakes.ts";

const WASM = fileURLToPath(new URL("../../contract/target/near/nearkat_nft.wasm", import.meta.url));
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
describe.skipIf(!existsSync(WASM) || !existsSync(MPC_WASM))(
  "context keys from the MPC network, contexts on FastFS, keeper hand-over",
  () => {
    let sandbox: Sandbox;
    let contractId: string;
    let keySource: { mpc_contract_id: string; domain_id: number };
    let admin: Near;
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
          },
        })
        .send();
    }, 180_000);

    afterAll(async () => {
      await sandbox?.stop();
    });

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
  },
);
