import { createHash, randomBytes } from "node:crypto";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { base58 } from "@scure/base";
import type { KeyProof, SampleView } from "../../keeper/src/chain.ts";
import { appId, type KeySource, sampleKey, sampleKeyPath } from "../../keeper/src/ckd.ts";
import { FastfsStore } from "../../keeper/src/fastfs.ts";
import type { LoanView } from "../../keeper/src/loans.ts";
import { sealSample } from "../../keeper/src/samples.ts";
import {
  ContractRefusal,
  type LoanTraining,
  type TrainerChain,
  type TrainingRecord,
} from "../src/chain.ts";
import type { runPython } from "../src/python.ts";

export const KEY_SOURCE: KeySource = { mpc_contract_id: "v1.signer", domain_id: 2 };
export const CONTRACT = "cats-vs-dogs.launch.near";
export const APP_ID = "a".repeat(64);
export const RENTER = "renter.near";

const G1 = bls.G1.Point;
const DST = "NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_";
const encode = (point: InstanceType<typeof G1>) =>
  `bls12381g1:${base58.encode(point.toBytes(true))}`;

/** A JPEG stand-in: the pipeline never looks inside. */
export const jpegFor = (tokenId: string) => Buffer.from(`jpeg of sample ${tokenId}`);

/** One dataset collection, its MPC network and its FastFS files, in memory. */
export class FakeTrainerChain implements TrainerChain {
  readonly mpcSecret = 0x5eed_cafen;
  classes: string[] | null = ["cat", "dog"];
  readonly loans = new Map<string, LoanView>();
  readonly training = new Map<string, LoanTraining>();
  readonly samples = new Map<string, SampleView>();
  readonly records: TrainingRecord[] = [];
  readonly keyRequests: string[][] = [];
  /** Thrown by every recordTraining call, as a contract panic would be. */
  recordFailure: string | null = null;
  /** What each recordTraining call does in turn: throw the error, or succeed (null). */
  readonly recordScript: Array<Error | null> = [];
  recordCalls = 0;
  /** This many calls land on-chain, then their reply is lost as a transport error. */
  landedButLost = 0;
  readonly registered = new Set<string>();
  readonly #txs = new Map<string, Uint8Array[]>();
  readonly #store = new FastfsStore({
    uploader: "keeper.near",
    receiver: CONTRACT,
    upload: async (_receiver, args) => this.#tx([args]),
    uploadMany: async (_receiver, argsList) => this.#tx(argsList),
    transactionArgs: async (txHash) => this.#txs.get(txHash) ?? [],
    gatewayUrl: null,
  });

  #tx(args: Uint8Array[]): string {
    const hash = base58.encode(randomBytes(32));
    this.#txs.set(hash, args);
    return hash;
  }

  /** The key the MPC network derives for a sample, as the keeper would have sealed it with. */
  #sampleKey(tokenId: string): Buffer {
    const pk = bls.G2.Point.BASE.multiply(this.mpcSecret).toBytes(true);
    const hashed = bls.G1.hashToCurve(
      new Uint8Array([...pk, ...appId(CONTRACT, sampleKeyPath(tokenId))]),
      { DST },
    ) as unknown as InstanceType<typeof G1>;
    return sampleKey(hashed.multiply(this.mpcSecret).toBytes(true), tokenId);
  }

  /** Seals a sample into FastFS and rents it to `renter` for the app. */
  async addRentedSample(tokenId: string, label: string, renter = RENTER): Promise<void> {
    const blob = sealSample(this.#sampleKey(tokenId), {
      v: 1,
      token_id: tokenId,
      label,
      jpeg: jpegFor(tokenId).toString("base64"),
    });
    const ref = await this.#store.put(blob);
    this.samples.set(tokenId, {
      owner_id: "lender.near",
      sample_hash: createHash("sha256").update(blob).digest("base64"),
      sample_ref: ref,
      runs: 0,
    });
    this.loans.set(tokenId, {
      token_id: tokenId,
      status: "active",
      lender_id: "lender.near",
      borrower_id: renter,
      duration_s: "3600",
      messages: null,
      sees_memory: false,
      learns: false,
      fee: "0",
      started_at: "1",
      ends_at: "2",
    });
    this.training.set(tokenId, { apps: [APP_ID], app_id: APP_ID, spent: false });
  }

  async getCollection(_contract: string) {
    return { classes: this.classes, key_source: KEY_SOURCE };
  }

  async getLoan(_contract: string, id: string) {
    return this.loans.get(id) ?? null;
  }

  async getLoanTraining(_contract: string, id: string) {
    return this.training.get(id) ?? null;
  }

  async getSample(_contract: string, id: string) {
    return this.samples.get(id) ?? null;
  }

  async requestSampleKeys(_contract: string, ids: string[], appPublicKey: string) {
    this.keyRequests.push(ids);
    if (ids.length > 10) {
      throw new Error("At most 10 keys per call");
    }
    const pk = bls.G2.Point.BASE.multiply(this.mpcSecret).toBytes(true);
    const app = G1.fromBytes(base58.decode(appPublicKey.replace(/^bls12381g1:/, "")));
    return ids.map((id) => {
      const training = this.training.get(id);
      if (!training || training.spent) {
        return null;
      }
      const hashed = bls.G1.hashToCurve(
        new Uint8Array([...pk, ...appId(CONTRACT, sampleKeyPath(id))]),
        { DST },
      ) as unknown as InstanceType<typeof G1>;
      const y = bls.fields.Fr.fromBytes(bls.utils.randomSecretKey());
      return {
        big_y: encode(G1.BASE.multiply(y)),
        big_c: encode(hashed.multiply(this.mpcSecret).add(app.multiply(y))),
      };
    });
  }

  async recordTraining(_contract: string, run: TrainingRecord): Promise<void> {
    this.recordCalls += 1;
    const scripted = this.recordScript.shift();
    if (scripted) {
      throw scripted;
    }
    if (this.recordFailure) {
      throw new ContractRefusal(this.recordFailure);
    }
    if (run.token_ids.length > 50) {
      throw new Error("1 to 50 samples per call");
    }
    for (const id of run.token_ids) {
      const training = this.training.get(id);
      if (training) {
        training.spent = true;
      }
    }
    this.records.push(run);
    if (this.landedButLost > 0) {
      this.landedButLost -= 1;
      throw new Error("fetch failed");
    }
  }

  async getRunTokens(_contract: string, runId: string): Promise<string[]> {
    return this.records.filter((r) => r.run_id === runId).flatMap((r) => r.token_ids);
  }

  async isAppKeyRegistered(_contract: string, publicKey: string) {
    return this.registered.has(publicKey);
  }

  async registerAppKey(_contract: string, proof: KeyProof & { label: string }) {
    this.registered.add(proof.public_key);
  }

  async mpcPublicKey(_source: KeySource) {
    return `bls12381g2:${base58.encode(bls.G2.Point.BASE.multiply(this.mpcSecret).toBytes(true))}`;
  }

  fastfsStore(_contract: string) {
    return this.#store;
  }
}

/** A Python stand-in: records what it was given and returns a fixed model. */
export class FakePython {
  readonly received: Array<{ label: string; jpeg: Buffer }> = [];
  model = Buffer.from("onnx model bytes");
  accuracy = 0.875;
  heldout = 8;
  /** Rejects as the real one does when the process fails. */
  failure: Error | null = null;
  /** Resolves the run when set; otherwise it finishes at once. */
  gate: Promise<void> | null = null;

  readonly run: typeof runPython = async (args) => {
    for await (const sample of args.samples) {
      this.received.push(sample);
    }
    args.onProgress({ stage: "loaded", count: this.received.length });
    args.onProgress({ stage: "epoch", epoch: 1, epochs: 2, loss: 0.5 });
    await this.gate;
    if (this.failure) {
      throw this.failure;
    }
    args.onProgress({ stage: "done", accuracy: this.accuracy, heldout: this.heldout, seconds: 1 });
    return { accuracy: this.accuracy, heldout: this.heldout, model: this.model };
  };
}
