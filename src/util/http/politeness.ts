/** Per-domain FIFO scheduling with jitter and a global concurrency ceiling. */
import type { FetchOpts, FetchResult, HttpClient } from './types.js';

export interface PolitenessOptions {
  concurrency: number;
  jitterMs: { min: number; max: number };
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

/** Serializes a registrable domain while allowing bounded cross-domain overlap. */
export class PoliteHttpClient implements HttpClient {
  private readonly domainQueues = new Map<string, Promise<unknown>>();
  private readonly usedDomains = new Set<string>();
  private readonly semaphore: Semaphore;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  public constructor(
    private readonly inner: HttpClient,
    private readonly options: PolitenessOptions,
  ) {
    this.semaphore = new Semaphore(options.concurrency);
    this.sleep = options.sleep ?? delay;
    this.random = options.random ?? Math.random;
  }

  public fetchText(url: string, options?: FetchOpts): Promise<FetchResult> {
    return this.schedule(url, () => this.inner.fetchText(url, options));
  }

  public postJson(url: string, body: unknown, options?: FetchOpts): Promise<FetchResult> {
    return this.schedule(url, () => this.inner.postJson(url, body, options));
  }

  private schedule(url: string, request: () => Promise<FetchResult>): Promise<FetchResult> {
    const domain = registrableDomain(url);
    const previous = this.domainQueues.get(domain) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      await this.semaphore.acquire();
      try {
        if (this.usedDomains.has(domain)) {
          await this.sleep(this.nextJitter());
        }
        this.usedDomains.add(domain);
        return await request();
      } finally {
        this.semaphore.release();
      }
    });
    this.domainQueues.set(domain, current);
    void current.then(
      () => this.removeCompletedQueue(domain, current),
      () => this.removeCompletedQueue(domain, current),
    );
    return current;
  }

  private nextJitter(): number {
    const { min, max } = this.options.jitterMs;
    return Math.floor(min + this.random() * (max - min + 1));
  }

  private removeCompletedQueue(domain: string, request: Promise<unknown>): void {
    if (this.domainQueues.get(domain) === request) {
      this.domainQueues.delete(domain);
    }
  }
}

/**
 * Returns an eTLD+1 approximation.
 *
 * @remarks A public-suffix dependency is disproportionate for the supported ATS hosts. This treats
 * the final two labels as one scheduling domain, deliberately serializing provider subdomains.
 */
export function registrableDomain(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  const labels = hostname.split('.').filter(Boolean);
  return labels.length > 1 ? labels.slice(-2).join('.') : hostname;
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  public constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('HTTP concurrency must be a positive integer.');
    }
  }

  public acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  public release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
