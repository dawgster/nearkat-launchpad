import { useCallback, useEffect, useState } from "react";

export type Async<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: unknown };

/**
 * Loads a value when `key` changes. `reload` loads it again in the
 * background, keeping the current value on screen until the new one arrives.
 * Pass a null key to wait.
 */
export function useAsync<T>(
  key: string | null,
  load: () => Promise<T>,
): [Async<T>, () => Promise<void>] {
  const [state, setState] = useState<Async<T>>({ status: "loading" });
  const [version, setVersion] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` is a fresh closure each render; `key` says when to reload.
  useEffect(() => {
    if (key === null) {
      return;
    }
    let current = true;
    if (version === 0) {
      setState({ status: "loading" });
    }
    load().then(
      (data) => current && setState({ status: "ready", data }),
      (error) => current && setState({ status: "error", error }),
    );
    return () => {
      current = false;
    };
  }, [key, version]);

  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  return [state, reload];
}
