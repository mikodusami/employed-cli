/** Provides an injectable HTTP boundary for all application network access. */
import { HTTP_USER_AGENT } from '../constants.js';
import { HttpError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Per-request policy overrides supported by the shared HTTP boundary. */
export interface FetchOpts {
  timeoutMs?: number;
}

/** Text response details required by ATS detection. */
export interface FetchResult {
  finalUrl: string;
  status: number;
  body: string;
  contentType: string | null;
}

/** Minimal text-oriented HTTP capability. */
export interface HttpClient {
  fetchText(url: string, options?: FetchOpts): Promise<FetchResult>;
  postJson(url: string, body: unknown, options?: FetchOpts): Promise<FetchResult>;
}

/** Uses Node's built-in undici fetch implementation with redirects and timeouts. */
export class UndiciHttpClient implements HttpClient {
  public async fetchText(
    url: string,
    options: FetchOpts = {},
  ): Promise<FetchResult> {
    return this.request(url, { method: 'GET' }, options);
  }

  public async postJson(
    url: string,
    body: unknown,
    options: FetchOpts = {},
  ): Promise<FetchResult> {
    return this.request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      options,
    );
  }

  private async request(
    url: string,
    init: RequestInit,
    options: FetchOpts,
  ): Promise<FetchResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...init.headers, 'user-agent': HTTP_USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return {
        finalUrl: response.url,
        status: response.status,
        body: await response.text(),
        contentType: response.headers.get('content-type'),
      };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpError(`HTTP request failed for ${url}: ${reason}`, { cause: error });
    }
  }
}
