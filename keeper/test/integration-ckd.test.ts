import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKey, Near, type PrivateKey } from "near-kit";
import { Sandbox } from "near-kit/sandbox";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { NearChain, transactionArgsFrom } from "../src/chain.ts";
import { fetchContextRoot } from "../src/ckd.ts";
import { FastfsStore } from "../src/fastfs.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { FileStore, MirroredStore } from "../src/store.ts";
import { FakeInference } from "./fakes.ts";

const WASM = fileURLToPath(new URL("../../contract/target/near/nearkat_nft.wasm", import.meta.url));
const MPC_WASM = fileURLToPath(
  new URL("../../mock-mpc/target/near/nearkat_mock_mpc.wasm", import.meta.url),
);
const KEY_SOURCE = { mpc_contract_id: "", domain_id: 2 };

// The real collection contract and a mock MPC contract doing the network's
// real CKD maths, in a local sandbox. Contexts are stored with FastFS and
// read back from the node's own transaction history.
describe.skipIf(!existsSync(WASM) || !existsSync(MPC_WASM))(
  "context keys from the MPC network, contexts on FastFS",
  () => {
    let sandbox: Sandbox;
    let contractId: string;
    let keeperId: string;
    let alice: Near;
    const service = (rootSecret: number, near: Near, dir: string, root: Buffer) => {
      const chain = new NearChain(near, contractId, "optimistic");
      const meter = new Meter(chain, { log: () => {} });
      const store = new MirroredStore(
        new FileStore(dir),
        new FastfsStore({
          uploader: keeperId,
          receiver: contractId,
          upload: (_receiver, args) => chain.uploadFastfs(args),
          transactionArgs: transactionArgsFrom(sandbox.rpcUrl),
          gatewayUrl: null,
        }),
      );
      return {
        chain,
        kats: new KatService({
          chain,
          store,
          keys: keysFromRootSecret(Buffer.alloc(32, rootSecret)).withContextRoot(root),
          inference: new FakeInference(),
          meter,
          prices: { chat: 1n, save: 1n },
          log: () => {},
        }),
      };
    };
    let keeperNear: Near;

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
      KEY_SOURCE.mpc_contract_id = mpc.id;

      const keeper = await account("keeper");
      keeperId = keeper.id;
      keeperNear = keeper.near;
      alice = (await account("alice")).near;
      const owner = await account("lantern");
      contractId = owner.id;
      await owner.near
        .transaction(contractId)
        .deployContract(contractId, await readFile(WASM))
        .functionCall(contractId, "new", {
          admin_id: root,
          keeper_id: keeperId,
          treasury_id: root,
          mint_price: (10n ** 24n).toString(),
          collection: {
            name: "Lantern",
            symbol: "LNT",
            base_uri: "https://art.example/",
            key_source: KEY_SOURCE,
          },
        })
        .send();
    }, 180_000);

    afterAll(async () => {
      await sandbox?.stop();
    });

    test("two keepers with different secrets get the same key, and read each other's contexts from the chain", async () => {
      const chain = new NearChain(keeperNear, contractId, "optimistic");
      expect((await chain.getCollection()).key_source).toEqual(KEY_SOURCE);
      const rootA = await fetchContextRoot(contractId, KEY_SOURCE, chain);
      const rootB = await fetchContextRoot(contractId, KEY_SOURCE, chain);
      // Each request uses a fresh throwaway key, yet the key it carries is the same.
      expect(rootA.equals(rootB)).toBe(true);

      const first = service(7, keeperNear, await mkdtemp(join(tmpdir(), "ckd-a-")), rootA);
      await alice.call(contractId, "mint", {}, { attachedDeposit: "3 NEAR" });
      let woken: string[] = [];
      for (let i = 0; i < 50 && woken.length === 0; i++) {
        woken = await first.kats.wakeNew();
        if (woken.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      expect(woken).toEqual(["1"]);
      const kat = await first.chain.getKat("1");
      expect(kat?.context_ref).toMatch(new RegExp(`^fastfs:${keeperId.replace(/\./g, "\\.")}:`));

      // A second keeper: another root secret, an empty disk.
      const second = service(9, keeperNear, await mkdtemp(join(tmpdir(), "ckd-b-")), rootB);
      const aliceId = (alice as unknown as { defaultSignerId: string }).defaultSignerId;
      let context: Awaited<ReturnType<KatService["getContext"]>> | null = null;
      for (let i = 0; i < 50 && !context; i++) {
        context = await second.kats.getContext(aliceId, "1").catch(() => null);
        if (!context) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      expect(context?.version).toBe(1);
    }, 120_000);
  },
);
