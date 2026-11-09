import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RentPanel } from "../src/components/RentPanel.tsx";

const NEAR = 10n ** 24n;
const offers = [
  { tokenId: "1", lender: "alice.near", fee: NEAR / 100n, apps: ["trainer.near"] },
  { tokenId: "2", lender: "bob.near", fee: NEAR / 50n, apps: ["trainer.near"] },
  { tokenId: "3", lender: "alice.near", fee: NEAR / 100n, apps: ["trainer.near", "other.near"] },
  { tokenId: "4", lender: "carol.near", fee: NEAR / 10n, apps: ["other.near"] },
];
const labels = { "trainer.near": "Trainer", "other.near": "Other" };

test("rents N samples for an app in one go", async () => {
  const borrow = vi.fn(async (ids: string[]) => ids.length);
  render(<RentPanel offers={offers} labels={labels} borrow={borrow} />);
  await userEvent.selectOptions(screen.getByLabelText("Training app"), "trainer.near");
  await userEvent.clear(screen.getByLabelText("How many samples"));
  await userEvent.type(screen.getByLabelText("How many samples"), "2");
  await userEvent.click(screen.getByRole("button", { name: /Rent 2 samples/ }));
  expect(borrow).toHaveBeenCalledTimes(1);
  const [ids, appId, total] = borrow.mock.calls[0] as unknown as [string[], string, bigint];
  expect(appId).toBe("trainer.near");
  // Cheapest first, one from each of two holders.
  expect([...ids].sort()).toEqual(["1", "2"]);
  expect(total).toBe(NEAR / 100n + NEAR / 50n);
  expect(await screen.findByText(/paid 2 holders/)).toBeTruthy();
});

test("offers only apps the samples are listed for", () => {
  render(<RentPanel offers={[offers[0] as (typeof offers)[0]]} labels={labels} borrow={vi.fn()} />);
  const select = screen.getByLabelText("Training app");
  expect(select.textContent).toContain("trainer.near");
  expect(select.textContent).not.toContain("other.near");
});
