/**
 * Maps over items with at most `limit` calls in flight, keeping results in
 * input order. For fan-out API work (one SAM call per frame) where running
 * everything at once would trip rate limits and running one at a time is slow.
 */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** Retries a call with exponential backoff - for transient API errors (rate limits, 5xx, timeouts). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 600): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}
