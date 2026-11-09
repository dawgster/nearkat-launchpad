import type { KeyProof, TrainerChain } from "./chain.ts";
import { RunFailure } from "./run.ts";

export interface RegisterOptions {
  chain: Pick<TrainerChain, "getAppKey" | "registerAppKey">;
  mode: "local" | "phala";
  /** The app id the collection knows this trainer by. */
  appId: string;
  /** The trainer's NEAR public key: the full-access key of its account, which signs the call. */
  publicKey: string;
  label: string;
  /** The attestation proof for the key; only asked for in phala mode. */
  proof: () => Promise<KeyProof>;
}

/**
 * Makes sure a collection knows this trainer's key as its own app's. In phala
 * mode a missing key is registered with a TDX quote, in a transaction signed
 * by that same key (which proves its possession). The two refusals are
 * `RunFailure`s, so the renter is told why; anything else stays generic. In local mode there is no
 * quote, so the collection's admin has to trust the key.
 */
export function ensureRegistered(o: RegisterOptions): (contract: string) => Promise<void> {
  /** Registrations in flight, so runs starting together register once. */
  const pending = new Map<string, Promise<void>>();

  async function register(contract: string): Promise<void> {
    const existing = await o.chain.getAppKey(contract, o.publicKey);
    if (existing) {
      if (existing.app_id !== o.appId) {
        throw new RunFailure(`This trainer's key is registered to another app on ${contract}`);
      }
      return;
    }
    if (o.mode !== "phala") {
      throw new RunFailure(
        `This trainer isn't trusted by ${contract}: its admin can trust key ${o.publicKey} with trust_app_key`,
      );
    }
    await o.chain.registerAppKey(contract, { ...(await o.proof()), label: o.label });
  }

  return (contract) => {
    let running = pending.get(contract);
    if (!running) {
      running = register(contract).finally(() => pending.delete(contract));
      pending.set(contract, running);
    }
    return running;
  };
}
