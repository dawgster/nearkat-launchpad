import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { type Dataset, DatasetDrop } from "../src/components/DatasetDrop.tsx";
import { type DroppedSample, TooLarge } from "../src/lib/samples.ts";

/** A file as a folder picker hands it over, with its path inside the folder. */
const picked = (path: string, type = "image/jpeg") => {
  const file = new File([new Uint8Array([1])], path.split("/").at(-1) as string, { type });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
};

test("shows counts per class and what was skipped", async () => {
  const prepare = vi.fn(async (sample: DroppedSample) => {
    if (sample.path.endsWith("huge.jpg")) {
      throw new TooLarge();
    }
    return {
      label: sample.label,
      jpeg: new Uint8Array([0xff, 0xd8]),
      thumb: `blob:${sample.path}`,
    };
  });
  const onChange = vi.fn<(dataset: Dataset | null) => void>();
  render(<DatasetDrop onChange={onChange} prepare={prepare} />);

  await userEvent.upload(screen.getByLabelText("Choose a folder"), [
    picked("set/hotdog/1.jpg"),
    picked("set/hotdog/2.jpg"),
    picked("set/hotdog/huge.jpg"),
    picked("set/not_hotdog/1.png", "image/png"),
    picked("set/.DS_Store", ""),
    picked("set/misc/3.jpg"),
  ]);

  // Every picture folder is a class to begin with; the creator can drop one.
  const classes = screen.getByLabelText("Classes");
  await waitFor(() => expect(classes).toHaveProperty("value", "hotdog, misc, not_hotdog"));
  await userEvent.clear(classes);
  await userEvent.type(classes, "hotdog, not_hotdog");

  const counts = screen.getByRole("list", { name: "Samples per class" });
  await waitFor(() => {
    expect(within(counts).getByText("hotdog").parentElement?.textContent).toContain("2");
    expect(within(counts).getByText("not_hotdog").parentElement?.textContent).toContain("1");
  });
  expect(screen.getAllByRole("img")).toHaveLength(3);

  const skipped = screen.getByRole("list", { name: "Skipped" });
  expect(within(skipped).getByText("set/.DS_Store").parentElement?.textContent).toContain(
    "not an image",
  );
  expect(within(skipped).getByText("set/misc/3.jpg").parentElement?.textContent).toContain(
    "no class folder",
  );
  expect(within(skipped).getByText("set/hotdog/huge.jpg").parentElement?.textContent).toContain(
    "too large",
  );

  // What the launch gets: samples in token order, and only what fits.
  await waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith({
      classes: ["hotdog", "not_hotdog"],
      samples: [
        expect.objectContaining({ path: "set/hotdog/1.jpg", label: "hotdog" }),
        expect.objectContaining({ path: "set/hotdog/2.jpg", label: "hotdog" }),
        expect.objectContaining({ path: "set/not_hotdog/1.png", label: "not_hotdog" }),
      ],
    }),
  );
});

test("revokes its thumbnails when it goes away", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const prepare = async (sample: DroppedSample) => ({
    label: sample.label,
    jpeg: new Uint8Array([0xff, 0xd8]),
    thumb: `blob:${sample.path}`,
  });
  const { unmount } = render(<DatasetDrop onChange={() => undefined} prepare={prepare} />);
  await userEvent.upload(screen.getByLabelText("Choose a folder"), [
    picked("set/a/1.jpg"),
    picked("set/b/1.jpg"),
  ]);
  await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
  unmount();
  expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual([
    "blob:set/a/1.jpg",
    "blob:set/b/1.jpg",
  ]);
  revoke.mockRestore();
});

test("revokes a thumbnail that finishes after it went away", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  let finish: (value: { label: string; jpeg: Uint8Array; thumb: string }) => void = () => undefined;
  const prepare = () =>
    new Promise<{ label: string; jpeg: Uint8Array; thumb: string }>((ok) => {
      finish = ok;
    });
  const { unmount } = render(<DatasetDrop onChange={() => undefined} prepare={prepare} />);
  await userEvent.upload(screen.getByLabelText("Choose a folder"), [picked("set/a/1.jpg")]);
  await waitFor(() => expect(screen.getByLabelText("Classes")).toBeTruthy());
  unmount();
  finish({ label: "a", jpeg: new Uint8Array([1]), thumb: "blob:late" });
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:late"));
  revoke.mockRestore();
});

test("a class isn't flagged empty while its pictures are still shrinking", async () => {
  let finish: (value: { label: string; jpeg: Uint8Array; thumb: string }) => void = () => undefined;
  const prepare = () =>
    new Promise<{ label: string; jpeg: Uint8Array; thumb: string }>((ok) => {
      finish = ok;
    });
  render(<DatasetDrop onChange={() => undefined} prepare={prepare} />);
  await userEvent.upload(screen.getByLabelText("Choose a folder"), [picked("set/a/1.jpg")]);
  const counts = screen.getByRole("list", { name: "Samples per class" });
  const item = await within(counts).findByText("a");
  expect(item.parentElement?.className).not.toContain("text-alarm");
  finish({ label: "a", jpeg: new Uint8Array([1]), thumb: "blob:a" });
  await waitFor(() => expect(item.parentElement?.textContent).toContain("1"));
  expect(item.parentElement?.className).not.toContain("text-alarm");
});
