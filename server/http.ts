import { config } from "./config.ts";

type Entry = { promise: Promise<unknown>; expires: number };

const cache = new Map<string, Entry>();
const MAX_ENTRIES = 5000;

/**
 * Memoise an async load by key for ttlMs. Concurrent callers share one in-flight
 * request; failed loads are not cached.
 */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise as Promise<T>;

  const promise = load();
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { promise, expires: Date.now() + ttlMs });
  promise.catch(() => cache.delete(key));
  return promise;
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": config.userAgent, Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Serialises calls so that consecutive ones start at least gapMs apart (for rate-limited APIs). */
export function throttle(gapMs: number) {
  let last = Promise.resolve();
  let lastStart = 0;
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = last.then(async () => {
      const wait = lastStart + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();
      return fn();
    });
    last = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
