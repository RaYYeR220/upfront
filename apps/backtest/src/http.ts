import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CACHE_DIR = fileURLToPath(new URL("../.cache/", import.meta.url));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-host throttle: at most `concurrency` requests in flight and at least
 * `spacingMs` between two request starts. Both public APIs we hit are free
 * services run by the French administration, so we stay well under their limits.
 */
class Throttle {
  private active = 0;
  private nextStart = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly spacingMs: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      // The finishing task hands its slot over directly, so `active` stays put.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      const now = Date.now();
      const start = Math.max(now, this.nextStart);
      this.nextStart = start + this.spacingMs;
      if (start > now) await sleep(start - now);
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

const throttles = new Map<string, Throttle>();

const HOST_LIMITS: Record<string, { concurrency: number; spacingMs: number }> = {
  "recherche-entreprises.api.gouv.fr": { concurrency: 2, spacingMs: 300 },
  "bodacc-datadila.opendatasoft.com": { concurrency: 4, spacingMs: 150 },
};

function throttleFor(url: string): Throttle {
  const host = new URL(url).host;
  let throttle = throttles.get(host);
  if (!throttle) {
    const limits = HOST_LIMITS[host] ?? { concurrency: 2, spacingMs: 500 };
    throttle = new Throttle(limits.concurrency, limits.spacingMs);
    throttles.set(host, throttle);
  }
  return throttle;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
  }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

async function fetchText(url: string, maxAttempts = 6): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let retryAfterMs = 0;
    try {
      const res = await throttleFor(url).run(() =>
        fetch(url, {
          headers: { accept: "application/json", "user-agent": "upfront-backtest/0.1" },
          signal: AbortSignal.timeout(120_000),
        }),
      );
      const body = await res.text();
      if (res.ok) return body;
      const error = new HttpError(res.status, url, body);
      if (!RETRYABLE.has(res.status)) throw error;
      lastError = error;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;
    } catch (error) {
      if (error instanceof HttpError && !RETRYABLE.has(error.status)) throw error;
      lastError = error;
    }
    const backoff = Math.max(retryAfterMs, 1000 * 2 ** attempt) + Math.random() * 250;
    await sleep(Math.min(backoff, 60_000));
  }
  throw lastError instanceof Error ? lastError : new Error(`giving up on ${url}`);
}

export type CacheStats = { hits: number; misses: number };
export const cacheStats: CacheStats = { hits: 0, misses: 0 };

/**
 * GET a JSON document, keeping the raw response body on disk so reruns are free
 * and deterministic. The cache key is the full URL.
 */
export async function getJson<T>(url: string, namespace: string): Promise<T> {
  const key = createHash("sha1").update(url).digest("hex");
  const dir = join(CACHE_DIR, namespace);
  const file = join(dir, `${key}.json`);
  try {
    const cached = await readFile(file, "utf8");
    cacheStats.hits++;
    return JSON.parse(cached) as T;
  } catch {
    // not cached yet
  }
  cacheStats.misses++;
  const body = await fetchText(url);
  const parsed = JSON.parse(body) as T;
  await mkdir(dir, { recursive: true });
  await writeFile(file, body);
  return parsed;
}

/** Run `fn` over `items` with bounded parallelism, preserving input order in the output. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
