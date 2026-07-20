/** Verifies static generated extraction, pagination, URL resolution, and escalation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ScraperConfig } from '../src/scrape/config.js';
import { GeneratedSource } from '../src/scrape/generated.js';
import type { CompanyRow } from '../src/db/index.js';
import { RequiresRenderError } from '../src/util/errors.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

const pageOne = readFileSync(new URL('fixtures/generated-page-1.html', import.meta.url), 'utf8');
const pageTwo = readFileSync(new URL('fixtures/generated-page-2.html', import.meta.url), 'utf8');

test('static config extracts fields and resolves relative posting URLs', async () => {
  const http = new FixtureHttp({ 'https://example.com/careers': pageOne });
  const source = new GeneratedSource(http, config('none', null, 1));

  const postings = await source.fetchPostings(company());

  assert.deepEqual(postings, [
    {
      title: 'Software Engineer',
      url: 'https://example.com/jobs/one',
      location: 'New York',
      department: null,
    },
    {
      title: 'Product Engineer',
      url: 'https://example.com/jobs/two',
      location: 'Remote',
      department: null,
    },
  ]);
});

test('next-link pagination follows the fixture link for two pages', async () => {
  const http = new FixtureHttp({
    'https://example.com/careers': pageOne,
    'https://example.com/page-2': pageTwo,
  });
  const source = new GeneratedSource(http, config('next-link', 'a.next', 2));

  const postings = await source.fetchPostings(company());

  assert.equal(postings.length, 3);
  assert.equal(postings[2]?.url, 'https://example.com/jobs/three');
  assert.deepEqual(http.urls, ['https://example.com/careers', 'https://example.com/page-2']);
});

test('url-param pagination substitutes the page number', async () => {
  const http = new FixtureHttp({
    'https://example.com/careers': pageOne,
    'https://example.com/jobs?page=2': pageTwo,
  });
  const source = new GeneratedSource(http, config('url-param', '/jobs?page={n}', 2));

  assert.equal((await source.fetchPostings(company())).length, 3);
  assert.deepEqual(http.urls, [
    'https://example.com/careers',
    'https://example.com/jobs?page=2',
  ]);
});

test('render-only pagination escalates without making an HTTP request', async () => {
  const http = new FixtureHttp({});
  const source = new GeneratedSource(http, config('load-more-button', 'button.more', 2));

  await assert.rejects(() => source.fetchPostings(company()), RequiresRenderError);
  assert.deepEqual(http.urls, []);
});

class FixtureHttp implements HttpClient {
  public readonly urls: string[] = [];

  public constructor(private readonly pages: Readonly<Record<string, string>>) {}

  public async fetchText(url: string): Promise<FetchResult> {
    this.urls.push(url);
    const body = this.pages[url];
    if (body === undefined) {
      return response(url, '', 404);
    }
    return response(url, body, 200);
  }

  public async postJson(): Promise<FetchResult> {
    throw new Error('Unexpected POST request.');
  }
}

function config(
  type: ScraperConfig['pagination']['type'],
  value: string | null,
  maxPages: number,
): ScraperConfig {
  return {
    strategy: 'static',
    listSelector: 'article.job',
    fields: {
      title: { selector: 'a.role', attr: 'text' },
      url: { selector: 'a.role', attr: 'href' },
      location: { selector: '.location', attr: 'text' },
      department: null,
    },
    pagination: { type, value, maxPages },
    urlPrefix: null,
    confidence: 0.9,
    notes: 'Fixture scraper.',
  };
}

function company(): CompanyRow {
  return {
    id: 1,
    name: 'Fixture',
    slug: null,
    careers_url: 'https://example.com/careers',
    tier: 'B',
    scrape_method: 'unknown',
    scraper_config: null,
    health: 'untested',
    consecutive_failures: 0,
    last_success: null,
    last_yield: null,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function response(url: string, body: string, status: number): FetchResult {
  return { finalUrl: url, body, status, contentType: 'text/html' };
}
