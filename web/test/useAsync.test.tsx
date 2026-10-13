import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useAsync } from "../src/lib/useAsync.ts";

describe("useAsync", () => {
  test("loads the value for its key", async () => {
    const { result } = renderHook(() => useAsync("a", async () => "value a"));
    expect(result.current[0]).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: "value a" }));
  });

  test("drops the old value as soon as the key changes", async () => {
    const { result, rerender } = renderHook(({ id }) => useAsync(id, async () => `value ${id}`), {
      initialProps: { id: "a" as string | null },
    });
    await waitFor(() => expect(result.current[0].status).toBe("ready"));
    rerender({ id: "b" });
    expect(result.current[0]).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: "value b" }));
  });

  test("shows nothing while there is no key, even after a value was loaded", async () => {
    const { result, rerender } = renderHook(({ id }) => useAsync(id, async () => "secret"), {
      initialProps: { id: "a" as string | null },
    });
    await waitFor(() => expect(result.current[0].status).toBe("ready"));
    rerender({ id: null });
    expect(result.current[0]).toEqual({ status: "loading" });
  });

  test("does not let a slow answer for an old key replace the current one", async () => {
    const resolvers = new Map<string, (value: string) => void>();
    const load = (id: string) => new Promise<string>((resolve) => resolvers.set(id, resolve));
    const { result, rerender } = renderHook(({ id }) => useAsync(id, () => load(id)), {
      initialProps: { id: "a" },
    });
    rerender({ id: "b" });
    await act(async () => resolvers.get("b")?.("value b"));
    await act(async () => resolvers.get("a")?.("value a"));
    expect(result.current[0]).toEqual({ status: "ready", data: "value b" });
  });

  test("keeps the value on screen while reloading, then shows the new one", async () => {
    let n = 0;
    const { result } = renderHook(() => useAsync("a", async () => `value ${++n}`));
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: "value 1" }));
    await act(() => result.current[1]());
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: "value 2" }));
  });

  test("keeps the last good value when a reload fails", async () => {
    let fail = false;
    const { result } = renderHook(() =>
      useAsync("a", async () => {
        if (fail) {
          throw new Error("offline");
        }
        return "good";
      }),
    );
    await waitFor(() => expect(result.current[0].status).toBe("ready"));
    fail = true;
    await act(() => result.current[1]());
    await act(async () => {});
    expect(result.current[0]).toEqual({ status: "ready", data: "good" });
  });

  test("reports an error when the first load fails, and recovers on reload", async () => {
    let fail = true;
    const { result } = renderHook(() =>
      useAsync("a", async () => {
        if (fail) {
          throw new Error("offline");
        }
        return "good";
      }),
    );
    await waitFor(() => expect(result.current[0].status).toBe("error"));
    fail = false;
    await act(() => result.current[1]());
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: "good" }));
  });
});
