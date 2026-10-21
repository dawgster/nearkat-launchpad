import { describe, expect, test, vi } from "vitest";
import { appIdProblem, Launchpad, promptFor, slugFrom, slugProblem } from "../src/lib/launchpad.ts";

describe("slugs", () => {
  test("are made from a collection name", () => {
    expect(slugFrom("Latin Tutor!")).toBe("latin-tutor");
    expect(slugFrom("  Café  Noir ")).toBe("cafe-noir");
    expect(slugFrom("x".repeat(40))).toHaveLength(32);
  });

  test("follow the contract's rules", () => {
    expect(slugProblem("latin-tutor-2")).toBeNull();
    for (const bad of ["", "Caps", "a_b", "-a", "a-", "a--b", "a.b", "x".repeat(33)]) {
      expect(slugProblem(bad), bad).not.toBeNull();
    }
  });
});

test("app ids are lowercase hex", () => {
  expect(appIdProblem("0a1b2c")).toBeNull();
  expect(appIdProblem("0A1B")).not.toBeNull();
  expect(appIdProblem("")).not.toBeNull();
});

test("fills in the name and number like the keeper", () => {
  expect(promptFor("You are {name} #{token_id}. {name}!", "Magister", "7")).toBe(
    "You are Magister #7. Magister!",
  );
});

test("launches with the arguments the factory expects", async () => {
  const call = vi.fn(async () => ({}));
  const near = { call } as unknown as ConstructorParameters<typeof Launchpad>[0];
  await new Launchpad(near, "launch.testnet").launch(
    {
      slug: "magister",
      name: "Magister",
      symbol: "LAT",
      mintPrice: 10n ** 24n,
      prompt: "p",
      starter: "s",
      maxSupply: 100,
      phalaAppId: "0a1b",
      keeperId: null,
    },
    3n * 10n ** 24n,
  );
  expect(call).toHaveBeenCalledWith(
    "launch.testnet",
    "launch",
    {
      args: {
        slug: "magister",
        mint_price: "1000000000000000000000000",
        collection: {
          name: "Magister",
          symbol: "LAT",
          base_uri: "",
          prompt: "p",
          starter: "s",
          max_supply: "100",
          tee: { Phala: { app_id: "0a1b" } },
        },
        keeper_id: null,
      },
    },
    { gas: "150 Tgas", attachedDeposit: "3000000000000000000000000 yocto" },
  );
});
