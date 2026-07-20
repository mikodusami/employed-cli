/** Raw Node/undici HTTP transport; policy is supplied by decorators. */
import { HTTP_USER_AGENT } from '../../constants.js';
import { HttpError } from '../errors.js';
import type { FetchOpts, FetchResult, HttpClient } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Uses Node's built-in undici fetch implementation with redirects and timeouts. */
export class UndiciHttpClient implements HttpClient {
  public async fetchText(url: string, options: FetchOpts = {}): Promise<FetchResult> {
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
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers.set(name, value);
    }
    headers.set('user-agent', HTTP_USER_AGENT);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      return {
        finalUrl: response.url,
        status: response.status,
        body: await response.text(),
        contentType: response.headers.get('content-type'),
        headers: Object.fromEntries(response.headers.entries()),
      };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpError(`HTTP request failed for ${url}: ${reason}`, { cause: error });
    }
  }
}
