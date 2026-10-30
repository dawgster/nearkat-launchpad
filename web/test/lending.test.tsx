import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LendPanel } from "../src/components/LendPanel.tsx";
import type { LoanView } from "../src/lib/contract.ts";
import { describeTerms, duration } from "../src/lib/loans.ts";

const loan = (overrides: Partial<LoanView> = {}): LoanView => ({
  token_id: "1",
  status: "active",
  lender_id: "alice.near",
  borrower_id: "bob.near",
  duration_s: "86400",
  messages: 5,
  sees_memory: false,
  learns: false,
  fee: "0",
  started_at: "1",
  ends_at: "86400000000001",
  ...overrides,
});

describe("loan terms", () => {
  test("read as one sentence", () => {
    expect(describeTerms(loan(), "kat")).toBe(
      "for a day, 5 messages, free. The kat talks from its character only, not its memory, and comes back unchanged by what they say.",
    );
    expect(
      describeTerms(
        loan({
          duration_s: null,
          messages: null,
          fee: "1000000000000000000000000",
          sees_memory: true,
          learns: true,
        }),
        "token",
      ),
    ).toBe(
      "until it's ended, as many messages as they like, for 1 NEAR. The token can draw on its memory, and what they say can change it.",
    );
    expect(duration(7200)).toBe("2 hours");
  });
});

describe("LendPanel", () => {
  test("lends to someone for a day, a few messages, without memory or learning by default", async () => {
    const lend = vi.fn(async () => {});
    render(
      <LendPanel
        name="Nearkat #1"
        noun="kat"
        network="testnet"
        loan={null}
        lend={lend}
        end={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText("Account to lend it to"), "bob.testnet");
    await userEvent.type(screen.getByLabelText("Messages they may send"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Lend it" }));
    expect(lend).toHaveBeenCalledWith({
      borrowerId: "bob.testnet",
      durationSeconds: 86_400,
      messages: 3,
      seesMemory: false,
      learns: false,
      fee: 0n,
    });
    expect(await screen.findByText(/Lent to bob.testnet/)).toBeTruthy();
  });

  test("offers it for rent to anyone when there's a fee and no borrower", async () => {
    const lend = vi.fn(async () => {});
    render(
      <LendPanel
        name="Nearkat #1"
        noun="kat"
        network="testnet"
        loan={null}
        lend={lend}
        end={vi.fn()}
      />,
    );
    await userEvent.clear(screen.getByLabelText("Fee in NEAR"));
    await userEvent.type(screen.getByLabelText("Fee in NEAR"), "0.5");
    await userEvent.selectOptions(screen.getByLabelText("How long to lend it for"), "No end");
    await userEvent.click(screen.getByRole("button", { name: "Offer it for rent" }));
    expect(lend).toHaveBeenCalledWith(
      expect.objectContaining({ borrowerId: null, durationSeconds: null, fee: 5n * 10n ** 23n }),
    );
  });

  test("shows a loan under way, and lets the owner end a free one but not a paid one", async () => {
    const end = vi.fn(async () => {});
    const { rerender } = render(
      <LendPanel
        name="Nearkat #1"
        noun="kat"
        network="testnet"
        loan={loan()}
        lend={vi.fn()}
        end={end}
      />,
    );
    expect(screen.getByTestId("loan-status").textContent).toContain("Lent to bob.near, until");
    await userEvent.click(screen.getByRole("button", { name: "End the loan" }));
    expect(end).toHaveBeenCalled();
    rerender(
      <LendPanel
        name="Nearkat #1"
        noun="kat"
        network="testnet"
        loan={loan({ fee: "1000000000000000000000000" })}
        lend={vi.fn()}
        end={end}
      />,
    );
    expect(screen.queryByRole("button", { name: "End the loan" })).toBeNull();
    expect(screen.getByText(/It's rented/)).toBeTruthy();
  });
});
