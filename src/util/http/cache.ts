/** Conditional GET caching backed by SQLite migration 2. */
import type Database from 'better-sqlite3';

import type { FetchOpts, FetchResult, HttpClient } from './types.js';

interface HttpCacheRow {
  url: string;
  etag: string | null;
  last_modified: string | null;
  body: string;
  content_type: string | null;
  fetched_at: string;
}

/** Revalidates cached GETs and synthesizes complete responses from HTTP 304 results. */
export class CachingHttpClient implements HttpClient {
  private readonly findStatement: Database.Statement<[string], HttpCacheRow>;
  private readonly upsertStatement: Database.Statement;

  public constructor(
    private readonly inner: HttpClient,
    database: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.findStatement = database.prepare('SELECT * FROM http_cache WHERE url = ?');
    this.upsertStatement = database.prepare(`
      INSERT INTO http_cache (url, etag, last_modified, body, content_type, fetched_at)
      VALUES (@url, @etag, @last_modified, @body, @content_type, @fetched_at)
      ON CONFLICT(url) DO UPDATE SET
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        body = excluded.body,
        content_type = excluded.content_type,
        fetched_at = excluded.fetched_at
    `);
  }

  public async fetchText(url: string, options: FetchOpts = {}): Promise<FetchResult> {
    const cached = this.findStatement.get(url);
    const response = await this.inner.fetchText(url, addValidators(options, cached));
    if (response.status === 304 && cached) {
      return {
        finalUrl: response.finalUrl,
        status: 200,
        body: cached.body,
        contentType: cached.content_type,
        headers: response.headers,
        fromCache: true,
      };
    }
    if (response.status === 200) {
      this.upsertStatement.run({
        url,
        etag: getHeader(response.headers, 'etag') ?? null,
        last_modified: getHeader(response.headers, 'last-modified') ?? null,
        body: response.body,
        content_type: response.contentType,
        fetched_at: this.now().toISOString(),
      });
    }
    return response;
  }

  public postJson(url: string, body: unknown, options?: FetchOpts): Promise<FetchResult> {
    return this.inner.postJson(url, body, options);
  }
}

function addValidators(options: FetchOpts, cached: HttpCacheRow | undefined): FetchOpts {
  if (!cached) {
    return options;
  }
  const headers: Record<string, string> = { ...options.headers };
  if (cached.etag) {
    headers['if-none-match'] = cached.etag;
  }
  if (cached.last_modified) {
    headers['if-modified-since'] = cached.last_modified;
  }
  return { ...options, headers };
}

function getHeader(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  const expected = name.toLowerCase();
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === expected)?.[1];
}
