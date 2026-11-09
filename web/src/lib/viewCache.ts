/**
 * The view calls of one page: at most `limit` in flight, so a page that scans
 * 200 samples doesn't flood the RPC endpoint, and the results of scan views
 * kept until `clear`, so two scans of the same tokens read each once.
 */
export class ViewCache {
  readonly #limit: number;
  readonly #cache = new Map<string, Promise<unknown>>();
  readonly #waiting: Array<() => void> = [];
  #running = 0;

  constructor(limit = 8) {
    this.#limit = limit;
  }

  /** Loads `key`, from the cache when `cache` is set and it is there. A failure is never kept. */
  run<T>(key: string, load: () => Promise<T>, cache: boolean): Promise<T> {
    if (!cache) {
      return this.#limited(load);
    }
    const hit = this.#cache.get(key);
    if (hit) {
      return hit as Promise<T>;
    }
    const pending = this.#limited(load);
    this.#cache.set(key, pending);
    pending.catch(() => {
      if (this.#cache.get(key) === pending) {
        this.#cache.delete(key);
      }
    });
    return pending;
  }

  /** Forgets every cached result: the next reads go to the chain. */
  clear(): void {
    this.#cache.clear();
  }

  async #limited<T>(load: () => Promise<T>): Promise<T> {
    while (this.#running >= this.#limit) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#running += 1;
    try {
      return await load();
    } finally {
      this.#running -= 1;
      this.#waiting.shift()?.();
    }
  }
}
