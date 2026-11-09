import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ListSamplesPanel, ListSamplesUnavailable } from "../src/components/ListSamplesPanel.tsx";

const apps: Array<[string, string]> = [
  ["trainer.near", "Trainer"],
  ["other.near", ""],
];

test("lists some samples to the chosen apps", async () => {
  const list = vi.fn(async (ids: string[]) => ids.length);
  render(<ListSamplesPanel available={["4", "5", "6"]} apps={apps} list={list} />);
  await userEvent.clear(screen.getByLabelText("How many to list"));
  await userEvent.type(screen.getByLabelText("How many to list"), "2");
  await userEvent.clear(screen.getByLabelText("Fee per sample in NEAR"));
  await userEvent.type(screen.getByLabelText("Fee per sample in NEAR"), "0.5");
  await userEvent.selectOptions(screen.getByLabelText("How long a rental lasts"), "Until used");
  await userEvent.click(screen.getByRole("checkbox", { name: /Trainer/ }));
  await userEvent.click(screen.getByRole("button", { name: "List for rent" }));
  expect(list).toHaveBeenCalledWith(["4", "5"], {
    durationS: null,
    fee: 5n * 10n ** 23n,
    apps: ["trainer.near"],
  });
  expect(await screen.findByText("Listed 2 samples.")).toBeTruthy();
});

test.each([
  ["a count that is too high", "9", "0.01", true, /Choose between 1 and 3 samples/],
  ["a fee that is not an amount", "1", "lots", true, /amount in NEAR/],
  ["no training app", "1", "0.01", false, /Pick 1 to 8 training apps/],
])("refuses %s without listing", async (_name, count, fee, pick, message) => {
  const list = vi.fn(async () => 0);
  render(<ListSamplesPanel available={["4", "5", "6"]} apps={apps} list={list} />);
  await userEvent.clear(screen.getByLabelText("How many to list"));
  await userEvent.type(screen.getByLabelText("How many to list"), count);
  await userEvent.clear(screen.getByLabelText("Fee per sample in NEAR"));
  await userEvent.type(screen.getByLabelText("Fee per sample in NEAR"), fee);
  if (pick) {
    await userEvent.click(screen.getByRole("checkbox", { name: /Trainer/ }));
  }
  await userEvent.click(screen.getByRole("button", { name: "List for rent" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(message);
  expect(list).not.toHaveBeenCalled();
});

test("shows why listing failed", async () => {
  const list = vi.fn(async () => {
    throw new Error("The wallet said no.");
  });
  render(<ListSamplesPanel available={["4"]} apps={apps} list={list} />);
  await userEvent.click(screen.getByRole("checkbox", { name: /Trainer/ }));
  await userEvent.click(screen.getByRole("button", { name: "List for rent" }));
  expect((await screen.findByRole("alert")).textContent).toContain("The wallet said no.");
});

test("says so when there is nothing to list", () => {
  render(<ListSamplesPanel available={[]} apps={apps} list={vi.fn()} />);
  expect(screen.getByText("You have no samples free to list.")).toBeTruthy();
});

test("leaves samples on offer out unless asked to change their terms", async () => {
  const list = vi.fn(async (ids: string[]) => ids.length);
  render(<ListSamplesPanel available={["4", "5"]} offered={["1", "2"]} apps={apps} list={list} />);
  expect(screen.getByText("New samples (2)")).toBeTruthy();
  await userEvent.click(screen.getByRole("checkbox", { name: /Trainer/ }));
  await userEvent.click(screen.getByRole("button", { name: "List for rent" }));
  expect(list).toHaveBeenLastCalledWith(["4", "5"], expect.anything());
  await userEvent.click(
    screen.getByRole("checkbox", { name: /change the terms of the 2 samples you already have/ }),
  );
  await userEvent.clear(screen.getByLabelText("How many to list"));
  await userEvent.type(screen.getByLabelText("How many to list"), "1");
  await userEvent.click(screen.getByRole("button", { name: "List for rent" }));
  expect(list).toHaveBeenLastCalledWith(["4", "1", "2"], expect.anything());
  expect(await screen.findByText("Listed 3 samples.")).toBeTruthy();
});

test("changes the terms of samples on offer when none are new", async () => {
  const list = vi.fn(async (ids: string[]) => ids.length);
  render(<ListSamplesPanel available={[]} offered={["1"]} apps={apps} list={list} />);
  await userEvent.click(screen.getByRole("checkbox", { name: /Trainer/ }));
  await userEvent.click(screen.getByRole("button", { name: "List for rent" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/Tick the box/);
  expect(list).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox", { name: /change the terms of the sample/ }));
  await userEvent.click(screen.getByRole("button", { name: "List for rent" }));
  expect(list).toHaveBeenCalledWith(["1"], expect.anything());
  expect(await screen.findByText("Listed 1 sample.")).toBeTruthy();
});

test("withdraws every offer", async () => {
  const withdraw = vi.fn(async (ids: string[]) => ids.length);
  render(
    <ListSamplesPanel
      available={["4"]}
      offered={["1", "2"]}
      apps={apps}
      list={vi.fn()}
      withdraw={withdraw}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Withdraw your 2 offers" }));
  expect(withdraw).toHaveBeenCalledWith(["1", "2"]);
  expect(await screen.findByText("Withdrew the offers on 2 samples.")).toBeTruthy();
});

test("shows why withdrawing failed", async () => {
  const withdraw = vi.fn(async () => {
    throw new Error("The wallet said no.");
  });
  render(
    <ListSamplesPanel
      available={[]}
      offered={["1"]}
      apps={apps}
      list={vi.fn()}
      withdraw={withdraw}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Withdraw your offer" }));
  expect((await screen.findByRole("alert")).textContent).toContain("The wallet said no.");
});

test("has no withdraw button with nothing on offer", () => {
  render(<ListSamplesPanel available={["4"]} apps={apps} list={vi.fn()} withdraw={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /Withdraw/ })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: /change the terms/ })).toBeNull();
});

test("says so when the samples can't be read, and retries", async () => {
  const onRetry = vi.fn();
  render(<ListSamplesUnavailable error={new Error("RPC down")} onRetry={onRetry} />);
  expect(screen.getByRole("alert").textContent).toContain("RPC down");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalled();
});
