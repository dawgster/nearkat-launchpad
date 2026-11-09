import { describe, expect, test, vi } from "vitest";
import { ensureRegistered } from "../src/register.ts";
import { APP_ID, CONTRACT, FakeTrainerChain } from "./fakes.ts";

const PK = "ed25519:trainerkey";
const proof = {
  public_key: PK,
  seal_public_key: "ff",
  quote: "aa",
  collateral: "{}",
  event_log: "[]",
};

function setup(mode: "local" | "phala") {
  const chain = new FakeTrainerChain();
  const makeProof = vi.fn(async () => proof);
  const register = ensureRegistered({
    chain,
    mode,
    appId: APP_ID,
    publicKey: PK,
    label: "Hotdog CNN",
    proof: makeProof,
  });
  return { chain, register, makeProof };
}

describe("ensureRegistered", () => {
  test("does nothing when the key is registered to this app", async () => {
    const { chain, register, makeProof } = setup("phala");
    chain.appKeys.set(PK, APP_ID);
    const spy = vi.spyOn(chain, "registerAppKey");
    await register(CONTRACT);
    expect(spy).not.toHaveBeenCalled();
    expect(makeProof).not.toHaveBeenCalled();
  });

  test("fails clearly when the key belongs to another app", async () => {
    const { chain, register } = setup("phala");
    chain.appKeys.set(PK, "b".repeat(64));
    await expect(register(CONTRACT)).rejects.toThrow(
      `This trainer's key is registered to another app on ${CONTRACT}`,
    );
  });

  test("in phala mode, registers with a proof and the label", async () => {
    const { chain, register } = setup("phala");
    const spy = vi.spyOn(chain, "registerAppKey");
    await register(CONTRACT);
    expect(spy).toHaveBeenCalledWith(CONTRACT, { ...proof, label: "Hotdog CNN" });
    expect(chain.appKeys.get(PK)).toBe(APP_ID);
  });

  test("registers once when several runs ask at once", async () => {
    const { chain, register } = setup("phala");
    const spy = vi.spyOn(chain, "registerAppKey");
    await Promise.all([register(CONTRACT), register(CONTRACT)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("a failed registration is forgotten, so the next run tries again", async () => {
    const { chain, register } = setup("phala");
    const spy = vi.spyOn(chain, "registerAppKey").mockRejectedValueOnce(new Error("RPC timed out"));
    await expect(register(CONTRACT)).rejects.toThrow("RPC timed out");
    await register(CONTRACT);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(chain.appKeys.get(PK)).toBe(APP_ID);
  });

  test("in local mode, says the admin must trust the key", async () => {
    const { register } = setup("local");
    await expect(register(CONTRACT)).rejects.toThrow(
      `This trainer isn't trusted by ${CONTRACT}: its admin can trust key ${PK} with trust_app_key`,
    );
  });
});
