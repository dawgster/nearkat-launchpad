import { useCallback, useEffect, useRef, useState } from "react";

export type Async<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: unknown };

const LOADING = { status: "loading" } as const;

/**
 * Loads a value for `key`. A value is only ever shown for the key it was
 * loaded for: when the key changes, or becomes null, the old value is gone
 * at once. `reload` loads again in the background and keeps the current
 * value on screen, including when that reload fails.
 */
export function useAsync<T>(
  key: string | null,
  load: () => Promise<T>,
): [Async<T>, () => Promise<void>] {
  const [held, setHeld] = useState<{ key: string | null; state: Async<T> }>({
    key,
    state: LOADING,
  });
  const [version, setVersion] = useState(0);
  // Always the latest closure, so a reload uses current props without re-running the effect.
  const latest = useRef(load);
  latest.current = load;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the reload trigger.
  useEffect(() => {
    if (key === null) {
      return;
    }
    let current = true;
    latest.current().then(
      (data) => current && setHeld({ key, state: { status: "ready", data } }),
      (error) =>
        current &&
        setHeld((before) =>
          // A failed background reload must not take away what is on screen.
          before.key === key && before.state.status === "ready"
            ? before
            : { key, state: { status: "error", error } },
        ),
    );
    return () => {
      current = false;
    };
  }, [key, version]);

  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  return [key !== null && held.key === key ? held.state : LOADING, reload];
}
