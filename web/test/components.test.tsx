import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Chat } from "../src/components/Chat.tsx";
import { FundPanel } from "../src/components/FundPanel.tsx";
import { GiveAwayPanel } from "../src/components/GiveAwayPanel.tsx";
import { MintPanel } from "../src/components/MintPanel.tsx";
import { PersonalityEditor } from "../src/components/PersonalityEditor.tsx";
import { type ChatReply, KeeperError } from "../src/lib/keeper.ts";

const NEAR = 10n ** 24n;
const reply = (text: string, balance = "5"): ChatReply => ({
  reply: text,
  balance,
  verification: {
    chat_id: "c",
    model: "m",
    request_hash: "a",
    response_hash: "b",
    signature: null,
  },
});

describe("MintPanel", () => {
  test("adds the mint price, storage allowance and starting balance", async () => {
    const onMint = vi.fn(async () => {});
    render(<MintPanel mintPrice={NEAR} onMint={onMint} onConnect={() => {}} />);
    expect(screen.getByText("2.02 NEAR")).toBeTruthy();
    expect(screen.getByText(/about 500 messages/)).toBeTruthy();

    const input = screen.getByLabelText("Starting balance");
    await userEvent.clear(input);
    await userEvent.type(input, "0.5");
    expect(screen.getByText("1.52 NEAR")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Mint a kat" }));
    expect(onMint).toHaveBeenCalledWith(NEAR / 2n);
  });

  test("blocks minting and explains when the amount is not a number", async () => {
    const onMint = vi.fn(async () => {});
    render(<MintPanel mintPrice={NEAR} onMint={onMint} onConnect={() => {}} />);
    const input = screen.getByLabelText("Starting balance");
    await userEvent.clear(input);
    await userEvent.type(input, "lots");
    expect(screen.getByText(/Enter an amount in NEAR/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mint a kat" })).toHaveProperty("disabled", true);
  });

  test("offers to connect a wallet instead when none is connected", async () => {
    const onConnect = vi.fn();
    render(<MintPanel mintPrice={NEAR} onMint={null} onConnect={onConnect} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet to mint" }));
    expect(onConnect).toHaveBeenCalled();
  });

  test("says what went wrong when the wallet request is cancelled", async () => {
    const onMint = vi.fn(async () => {
      throw new Error("User rejected the request");
    });
    render(<MintPanel mintPrice={NEAR} onMint={onMint} onConnect={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Mint a kat" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/cancelled the request/);
    expect(screen.getByRole("button", { name: "Mint a kat" })).toHaveProperty("disabled", false);
  });
});

describe("Chat", () => {
  function setup(send: (message: string) => Promise<ChatReply>) {
    const onReply = vi.fn();
    const onOutOfBalance = vi.fn();
    render(
      <Chat katName="Nearkat #1" send={send} onReply={onReply} onOutOfBalance={onOutOfBalance} />,
    );
    return { onReply, onOutOfBalance, box: screen.getByLabelText("Message to Nearkat #1") };
  }

  test("shows the message and the kat's reply, and reports the reply", async () => {
    const send = vi.fn(async () => reply("meow back"));
    const { onReply, box } = setup(send);
    await userEvent.type(box, "hello there");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(send).toHaveBeenCalledWith("hello there");
    expect(await screen.findByText("meow back")).toBeTruthy();
    expect(screen.getByText("hello there")).toBeTruthy();
    expect(onReply).toHaveBeenCalledWith(reply("meow back"));
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  test("sends on Enter and adds a line break on Shift+Enter", async () => {
    const send = vi.fn(async () => reply("ok"));
    const { box } = setup(send);
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two{Enter}");
    await waitFor(() => expect(send).toHaveBeenCalledWith("line one\nline two"));
  });

  test("does not send an empty message", async () => {
    const send = vi.fn(async () => reply("ok"));
    const { box } = setup(send);
    await userEvent.type(box, "   {Enter}");
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
  });

  test("puts an unanswered message back in the box and says why", async () => {
    const send = vi.fn(async () => {
      throw new KeeperError(503, "inference_unavailable", "down");
    });
    const { box, onOutOfBalance } = setup(send);
    await userEvent.type(box, "are you there?{Enter}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing was charged/);
    expect((box as HTMLTextAreaElement).value).toBe("are you there?");
    expect(screen.queryByText("You")).toBeNull();
    expect(onOutOfBalance).not.toHaveBeenCalled();
  });

  test("points at the balance when the kat has run out of NEAR", async () => {
    const send = vi.fn(async () => {
      throw new KeeperError(402, "insufficient_balance", "needs more");
    });
    const { box, onOutOfBalance } = setup(send);
    await userEvent.type(box, "hello{Enter}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/out of NEAR/);
    expect(onOutOfBalance).toHaveBeenCalled();
  });
});

describe("PersonalityEditor", () => {
  test("saves a changed personality and confirms it", async () => {
    const save = vi.fn(async () => {});
    render(<PersonalityEditor personality="curious" save={save} />);
    const button = screen.getByRole("button", { name: "Save personality" });
    expect(button).toHaveProperty("disabled", true);

    const box = screen.getByLabelText("Personality");
    await userEvent.clear(box);
    await userEvent.type(box, "grumpy");
    expect(screen.getByText("6 of 4,000 characters")).toBeTruthy();
    await userEvent.click(button);
    expect(save).toHaveBeenCalledWith("grumpy");
    expect(await screen.findByText("Personality saved.")).toBeTruthy();
    expect(button).toHaveProperty("disabled", true);
  });

  test("will not save an empty or over-long personality", async () => {
    render(<PersonalityEditor personality="curious" save={async () => {}} />);
    const box = screen.getByLabelText("Personality") as HTMLTextAreaElement;
    const button = screen.getByRole("button", { name: "Save personality" });
    await userEvent.clear(box);
    expect(button).toHaveProperty("disabled", true);
    await userEvent.click(box);
    await userEvent.paste("x".repeat(4001));
    expect(screen.getByText("4,001 of 4,000 characters")).toBeTruthy();
    expect(button).toHaveProperty("disabled", true);
  });

  test("keeps the draft and says why when the save fails", async () => {
    const save = vi.fn(async () => {
      throw new KeeperError(402, "insufficient_balance", "needs more");
    });
    render(<PersonalityEditor personality="curious" save={save} />);
    const box = screen.getByLabelText("Personality") as HTMLTextAreaElement;
    await userEvent.type(box, " and bold");
    await userEvent.click(screen.getByRole("button", { name: "Save personality" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/out of NEAR/);
    expect(box.value).toBe("curious and bold");
  });
});

describe("FundPanel", () => {
  test("shows the balance and adds the entered amount", async () => {
    const fund = vi.fn(async () => {});
    render(<FundPanel balance={NEAR + NEAR / 4n} urgent={false} fund={fund} />);
    expect(screen.getByText("1.25")).toBeTruthy();
    const input = screen.getByLabelText("NEAR to add");
    await userEvent.clear(input);
    await userEvent.type(input, "2");
    await userEvent.click(screen.getByRole("button", { name: "Add NEAR" }));
    expect(fund).toHaveBeenCalledWith(2n * NEAR);
  });

  test.each(["0", "", "abc"])("will not add %j", async (text) => {
    render(<FundPanel balance={NEAR} urgent={false} fund={async () => {}} />);
    const input = screen.getByLabelText("NEAR to add");
    await userEvent.clear(input);
    if (text) {
      await userEvent.type(input, text);
    }
    expect(screen.getByRole("button", { name: "Add NEAR" })).toHaveProperty("disabled", true);
  });
});

describe("GiveAwayPanel", () => {
  test("asks for confirmation before giving the kat away", async () => {
    const give = vi.fn(async () => {});
    render(<GiveAwayPanel katName="Nearkat #1" give={give} />);
    await userEvent.type(screen.getByLabelText("Account to give Nearkat #1 to"), "bob.near");
    await userEvent.click(screen.getByRole("button", { name: "Give Nearkat #1 away" }));
    expect(give).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Yes, give Nearkat #1 to bob.near" }));
    expect(give).toHaveBeenCalledWith("bob.near");
  });

  test("lets the owner back out at the confirmation step", async () => {
    const give = vi.fn(async () => {});
    render(<GiveAwayPanel katName="Nearkat #1" give={give} />);
    await userEvent.type(screen.getByLabelText("Account to give Nearkat #1 to"), "bob.near");
    await userEvent.click(screen.getByRole("button", { name: "Give Nearkat #1 away" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Give Nearkat #1 away" })).toBeTruthy();
    expect(give).not.toHaveBeenCalled();
  });

  test.each(["", "B", "Bob.near", "bob..near", "bob near", "a".repeat(65)])(
    "will not give to the invalid account %j",
    async (account) => {
      render(<GiveAwayPanel katName="Nearkat #1" give={async () => {}} />);
      if (account) {
        await userEvent.type(screen.getByLabelText("Account to give Nearkat #1 to"), account);
      }
      expect(screen.getByRole("button", { name: "Give Nearkat #1 away" })).toHaveProperty(
        "disabled",
        true,
      );
    },
  );

  test("accepts an implicit 64-character account", async () => {
    render(<GiveAwayPanel katName="Nearkat #1" give={async () => {}} />);
    await userEvent.type(screen.getByLabelText("Account to give Nearkat #1 to"), "a1".repeat(32));
    expect(screen.getByRole("button", { name: "Give Nearkat #1 away" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
