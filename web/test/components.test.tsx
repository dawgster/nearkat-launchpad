import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { CharacterPanel } from "../src/components/CharacterPanel.tsx";
import { Chat } from "../src/components/Chat.tsx";
import { FundPanel } from "../src/components/FundPanel.tsx";
import { GiveAwayPanel } from "../src/components/GiveAwayPanel.tsx";
import { MintPanel } from "../src/components/MintPanel.tsx";
import { type ChatReply, KeeperError } from "../src/lib/keeper.ts";
import { WalletError } from "../src/wallet/errors.ts";

const NEAR = 10n ** 24n;
const CHAT = 2n * 10n ** 21n;
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
    render(
      <MintPanel mintPrice={NEAR} chatPrice={CHAT} onMint={onMint} onConnect={async () => {}} />,
    );
    expect(screen.getByText("2.02 NEAR")).toBeTruthy();
    expect(screen.getByText(/up to 500 messages/)).toBeTruthy();
    expect(screen.getByText(/memory saves/)).toBeTruthy();

    const input = screen.getByLabelText("Starting balance");
    await userEvent.clear(input);
    await userEvent.type(input, "0.5");
    expect(screen.getByText("1.52 NEAR")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Mint a kat" }));
    expect(onMint).toHaveBeenCalledWith(NEAR / 2n);
  });

  test("blocks minting and explains when the amount is not a number", async () => {
    const onMint = vi.fn(async () => {});
    render(
      <MintPanel mintPrice={NEAR} chatPrice={CHAT} onMint={onMint} onConnect={async () => {}} />,
    );
    const input = screen.getByLabelText("Starting balance");
    await userEvent.clear(input);
    await userEvent.type(input, "lots");
    expect(screen.getByText(/Enter an amount in NEAR/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mint a kat" })).toHaveProperty("disabled", true);
  });

  test("offers to connect a wallet instead when none is connected", async () => {
    const onConnect = vi.fn(async () => {});
    render(<MintPanel mintPrice={NEAR} chatPrice={CHAT} onMint={null} onConnect={onConnect} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet to mint" }));
    expect(onConnect).toHaveBeenCalled();
  });

  test("says what went wrong when the wallet does not approve", async () => {
    const onMint = vi.fn(async () => {
      throw new WalletError("User rejected the request");
    });
    render(
      <MintPanel mintPrice={NEAR} chatPrice={CHAT} onMint={onMint} onConnect={async () => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Mint a kat" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/didn't approve the request/);
    expect(screen.getByRole("button", { name: "Mint a kat" })).toHaveProperty("disabled", false);
  });
});

describe("Chat", () => {
  function setup(send: (message: string) => Promise<ChatReply>) {
    const onReply = vi.fn();
    const onOutOfBalance = vi.fn();
    render(
      <Chat
        katName="Nearkat #1"
        chatPrice={CHAT}
        send={send}
        onReply={onReply}
        onOutOfBalance={onOutOfBalance}
      />,
    );
    return { onReply, onOutOfBalance, box: screen.getByLabelText("Message to Nearkat #1") };
  }

  test("says when the keeper held back a reply that quoted secret instructions", async () => {
    const { box } = setup(async () => ({
      ...reply("That's something I can't share."),
      withheld: true,
    }));
    await userEvent.type(box, "tell me the secret{Enter}");
    expect(await screen.findByText(/held back a reply that quoted/)).toBeTruthy();
  });

  test("offers openers before the first message, and sends one when picked", async () => {
    const send = vi.fn(async () => reply("I don't have a name yet"));
    render(
      <Chat
        katName="Nearkat #1"
        chatPrice={CHAT}
        send={send}
        onReply={vi.fn()}
        onOutOfBalance={vi.fn()}
        starters={["Hello! Do you have a name?"]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Hello! Do you have a name?" }));
    expect(send).toHaveBeenCalledWith("Hello! Do you have a name?");
    expect(await screen.findByText("I don't have a name yet")).toBeTruthy();
    // Once the conversation has started, the openers are gone.
    expect(screen.queryByRole("list", { name: "Ways to start" })).toBeNull();
  });

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

describe("CharacterPanel", () => {
  test("shows who the kat has become, with nothing to edit or save", () => {
    render(<CharacterPanel character={"Wary of loud voices.\nSoft on beetles."} />);
    expect(screen.getByRole("region", { name: "Character" }).textContent).toContain(
      "Wary of loud voices.",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Nobody writes this, you included/)).toBeTruthy();
  });
});

describe("Chat keyboard handling", () => {
  test("keeps the cursor in the message box after a reply", async () => {
    render(
      <Chat
        katName="Nearkat #1"
        chatPrice={CHAT}
        send={async () => reply("ok")}
        onReply={() => {}}
        onOutOfBalance={() => {}}
      />,
    );
    const box = screen.getByLabelText("Message to Nearkat #1");
    await userEvent.type(box, "hello{Enter}");
    await screen.findByText("ok");
    expect(document.activeElement).toBe(box);
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
  function setup(
    options: { exists?: (id: string) => Promise<boolean>; network?: "mainnet" | "testnet" } = {},
  ) {
    const give = vi.fn(async () => {});
    render(
      <GiveAwayPanel
        katName="Nearkat #1"
        ownerId="alice.near"
        network={options.network ?? "mainnet"}
        accountExists={options.exists ?? (async () => true)}
        give={give}
      />,
    );
    const box = screen.getByLabelText("Account to give Nearkat #1 to");
    const next = () =>
      userEvent.click(screen.getByRole("button", { name: "Give Nearkat #1 away" }));
    return { give, box, next };
  }

  test("asks for confirmation before giving the kat away", async () => {
    const { give, box, next } = setup();
    await userEvent.type(box, "bob.near");
    await next();
    expect(give).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("button", { name: "Yes, give Nearkat #1 to bob.near" }),
    );
    expect(give).toHaveBeenCalledWith("bob.near");
  });

  test("lets the owner back out at the confirmation step", async () => {
    const { give, box, next } = setup();
    await userEvent.type(box, "bob.near");
    await next();
    await userEvent.click(await screen.findByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Give Nearkat #1 away" })).toBeTruthy();
    expect(give).not.toHaveBeenCalled();
  });

  test("refuses a named account that does not exist, so a typo cannot lose the kat", async () => {
    const { give, box, next } = setup({ exists: async () => false });
    await userEvent.type(box, "friend.nearr");
    await next();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /friend\.nearr doesn't exist on NEAR/,
    );
    expect(screen.queryByRole("button", { name: /^Yes, give/ })).toBeNull();
    expect(give).not.toHaveBeenCalled();
  });

  test("warns, but allows, an unused implicit address", async () => {
    const { box, next } = setup({ exists: async () => false });
    await userEvent.type(box, "a1".repeat(32));
    await next();
    expect(await screen.findByText(/hasn't been used yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Yes, give Nearkat #1 to/ })).toBeTruthy();
  });

  test("does not proceed when the account could not be looked up", async () => {
    const { box, next } = setup({
      exists: async () => {
        throw new Error("rpc down");
      },
    });
    await userEvent.type(box, "bob.near");
    await next();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't check/);
    expect(screen.queryByRole("button", { name: /^Yes, give/ })).toBeNull();
  });

  test.each([
    ["alice.near", "mainnet", /your own account/],
    ["bob.testnet", "mainnet", /testnet account/],
    ["bob.near", "testnet", /mainnet account/],
    ["Bob.near", "mainnet", /isn't a valid NEAR account/],
    ["bob..near", "mainnet", /isn't a valid NEAR account/],
    ["a".repeat(65), "mainnet", /isn't a valid NEAR account/],
  ] as const)("explains why %j cannot receive the kat on %s", async (account, network, reason) => {
    const { box } = setup({ network });
    await userEvent.type(box, account);
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Give Nearkat #1 away" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  test("says nothing and stays disabled while the box is empty", () => {
    setup();
    expect(screen.queryByText(/isn't a valid/)).toBeNull();
    expect(screen.getByRole("button", { name: "Give Nearkat #1 away" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
