/** Provides an injectable HTTP boundary for all application network access. */
import { HTTP_USER_AGENT } from '../constants.js';
import { HttpError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Text response details required by ATS detection. */
export interface FetchResult {
  finalUrl: string;
  status: number;
  body: string;
  contentType: string | null;
}

/** Minimal text-oriented HTTP capability. */
export interface HttpClient {
  fetchText(url: string, options?: { timeoutMs?: number }): Promise<FetchResult>;
}

/** Uses Node's built-in undici fetch implementation with redirects and timeouts. */
export class UndiciHttpClient implements HttpClient {
  public async fetchText(
    url: string,
    options: { timeoutMs?: number } = {},
  ): Promise<FetchResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': HTTP_USER_AGENT },
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
