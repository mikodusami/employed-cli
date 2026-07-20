/** Bounded retry behavior for transient HTTP responses and transport failures. */
import { HttpError } from '../errors.js';
import type { FetchOpts, FetchResult, HttpClient } from './types.js';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

/** Retries only explicitly transient outcomes with exponential backoff. */
export class RetryHttpClient implements HttpClient {
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;

  public constructor(
    private readonly inner: HttpClient,
    private readonly options: RetryOptions,
  ) {
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new RangeError('HTTP max attempts must be a positive integer.');
    }
    this.sleep = options.sleep ?? delay;
    this.now = options.now ?? Date.now;
  }

  public fetchText(url: string, options?: FetchOpts): Promise<FetchResult> {
    return this.execute(() => this.inner.fetchText(url, options));
  }

  public postJson(url: string, body: unknown, options?: FetchOpts): Promise<FetchResult> {
    return this.execute(() => this.inner.postJson(url, body, options));
  }

  private async execute(request: () => Promise<FetchResult>): Promise<FetchResult> {
    for (let attempt = 0; attempt < this.options.maxAttempts; attempt += 1) {
      try {
        const result = await request();
        if (!isRetryableStatus(result.status) || attempt === this.options.maxAttempts - 1) {
          return result;
        }
        await this.sleep(retryDelay(result, attempt, this.options.baseDelayMs ?? 1000, this.now()));
      } catch (error: unknown) {
        if (!(error instanceof HttpError) || attempt === this.options.maxAttempts - 1) {
          throw error;
        }
        await this.sleep(exponentialDelay(attempt, this.options.baseDelayMs ?? 1000));
      }
    }
    throw new Error('Unreachable retry state.');
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

function retryDelay(
  result: FetchResult,
  attempt: number,
  baseDelayMs: number,
  now: number,
): number {
  const value = getHeader(result.headers, 'retry-after');
  if (!value) {
    return exponentialDelay(attempt, baseDelayMs);
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : exponentialDelay(attempt, baseDelayMs);
}

function exponentialDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt;
}

function getHeader(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  const expected = name.toLowerCase();
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === expected)?.[1];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
