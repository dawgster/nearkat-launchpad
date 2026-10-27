import type { Chain, KeyProof } from "./chain.ts";
import { MpcKeyring } from "./ckd.ts";
import { type CollectionInfo, collectionPrices, type KeeperPrices } from "./collection.ts";
import type { KatService } from "./kats.ts";
import type { Meter } from "./meter.ts";
import type { SealingKey } from "./sealing.ts";
import { teeMismatch } from "./tee.ts";

/** One collection this keeper serves, with its own meter and kats. */
export interface ServedCollection {
  contractId: string;
  info: CollectionInfo;
  /** What this collection charges, in yoctoNEAR. */
  prices: { chat: bigint; save: bigint };
  chain: Chain;
  meter: Meter;
  kats: KatService;
}

export interface CollectionsOptions {
  keeperAccountId: string;
  keeperPublicKey: string;
  runningAs: { mode: "local" } | { mode: "phala"; appId: string };
  chainFor(contractId: string): Chain;
  /** What this keeper charges, and needs to keep after any creator's share. */
  keeperPrices: KeeperPrices;
  /** Opens prompts sealed to this keeper. */
  sealing: SealingKey;
  build(
    contractId: string,
    chain: Chain,
    info: CollectionInfo,
    prices: { chat: bigint; save: bigint },
    keyring: MpcKeyring,
  ): { meter: Meter; kats: KatService };
  /** Proof that the keeper's key runs inside its TEE app. Absent in local mode. */
  proof?: () => Promise<KeyProof>;
  log?: (message: string) => void;
}

/**
 * The collections this keeper serves. A collection is served once its
 * contract names this keeper's account, any TEE requirement it has matches
 * where the keeper runs, and, for a TEE collection, the contract has accepted
 * the keeper's attested key. Anything short of that is retried later.
 */
export class Collections {
  readonly #o: CollectionsOptions;
  readonly #log: (message: string) => void;
  readonly #served = new Map<string, ServedCollection>();
  /** Why a collection is not served, as last found. */
  readonly #waiting = new Map<string, string>();
  readonly #adding = new Map<string, Promise<boolean>>();

  constructor(options: CollectionsOptions) {
    this.#o = options;
    this.#log = options.log ?? console.error;
  }

  get(contractId: string): ServedCollection | undefined {
    return this.#served.get(contractId);
  }

  all(): ServedCollection[] {
    return [...this.#served.values()];
  }

  /** Collections seen but not served, and why. */
  waiting(): Array<{ contractId: string; reason: string }> {
    return [...this.#waiting].map(([contractId, reason]) => ({ contractId, reason }));
  }

  /** Starts serving a collection if it can be. Safe to call repeatedly. */
  add(contractId: string): Promise<boolean> {
    if (this.#served.has(contractId)) {
      return Promise.resolve(true);
    }
    let adding = this.#adding.get(contractId);
    if (!adding) {
      adding = this.#add(contractId).finally(() => this.#adding.delete(contractId));
      this.#adding.set(contractId, adding);
    }
    return adding;
  }

  async #add(contractId: string): Promise<boolean> {
    const chain = this.#o.chainFor(contractId);
    let info: CollectionInfo;
    let keeperId: string;
    try {
      [info, keeperId] = await Promise.all([chain.getCollection(), chain.getKeeperId()]);
    } catch (error) {
      return this.#wait(contractId, `cannot read the contract: ${String(error)}`);
    }
    if (keeperId !== this.#o.keeperAccountId) {
      return this.#wait(contractId, `it names ${keeperId} as its keeper`);
    }
    const mismatch = teeMismatch(info, this.#o.runningAs);
    if (mismatch) {
      // Serving would put contexts somewhere the collection promised they would not be.
      return this.#wait(contractId, `refused: ${mismatch}`);
    }
    if (info.tee) {
      const attested = await this.#attest(chain);
      if (attested !== null) {
        return this.#wait(contractId, attested);
      }
    }
    const { chat, save, shortfall } = collectionPrices(info.terms, this.#o.keeperPrices);
    if (shortfall) {
      return this.#wait(contractId, shortfall);
    }
    const prices = { chat, save };
    if (info.sealed_prompt) {
      if (info.sealed_prompt.sealed_to.toLowerCase() !== this.#o.sealing.publicKeyHex) {
        return this.#wait(contractId, "its prompt is sealed to another keeper's key");
      }
      try {
        info = { ...info, secret_prompt: this.#o.sealing.open(info.sealed_prompt.ciphertext) };
      } catch {
        return this.#wait(contractId, "its sealed prompt cannot be opened");
      }
    }
    if (!info.key_source) {
      return this.#wait(contractId, "it has no key source: its contract predates MPC keys");
    }
    // Asked only now: for a TEE collection, the contract hands the key only
    // to an attested keeper key, registered above.
    const keyring = new MpcKeyring(contractId, info.key_source, chain);
    try {
      await keyring.ready();
    } catch (error) {
      return this.#wait(
        contractId,
        `could not get its context key from ${info.key_source.mpc_contract_id}: ${String(error)}`,
      );
    }
    const { meter, kats } = this.#o.build(contractId, chain, info, prices, keyring);
    this.#served.set(contractId, { contractId, info, prices, chain, meter, kats });
    this.#waiting.delete(contractId);
    this.#log(
      info.tee
        ? `Serving ${info.name} (${contractId}) inside Phala app ${info.tee.Phala.app_id}`
        : `Serving ${info.name} (${contractId})`,
    );
    return true;
  }

  /** Registers the keeper's key with a TEE collection. Returns why it failed, or null. */
  async #attest(chain: Chain): Promise<string | null> {
    try {
      if (await chain.isKeyAttested(this.#o.keeperPublicKey)) {
        return null;
      }
      if (!this.#o.proof) {
        return "its TEE requirement needs an attested key, and this keeper has no quote";
      }
      await chain.registerKeeperKey(await this.#o.proof());
      return null;
    } catch (error) {
      return `the contract did not accept this keeper's attestation: ${String(error)}`;
    }
  }

  #wait(contractId: string, reason: string): false {
    if (this.#waiting.get(contractId) !== reason) {
      this.#log(`Not serving ${contractId}: ${reason}`);
      this.#waiting.set(contractId, reason);
    }
    return false;
  }

  /**
   * Withdraws what each collection holds for the keeper once it reaches
   * `minimum`, so inference charges reach the account that pays for inference.
   */
  async withdrawEarnings(minimum: bigint): Promise<void> {
    for (const { contractId, chain } of this.#served.values()) {
      try {
        if ((await chain.getInferenceAccrued()) >= minimum) {
          await chain.withdrawInference();
        }
      } catch (error) {
        this.#log(`Withdrawing earnings from ${contractId} failed: ${String(error)}`);
      }
    }
  }
}
