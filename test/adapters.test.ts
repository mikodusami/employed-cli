/** Verifies Greenhouse and Lever mapping against compact recorded API responses. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { CompanyRow } from '../src/db/index.js';
import { GreenhouseAdapter } from '../src/scrape/adapters/greenhouse.js';
import { LeverAdapter } from '../src/scrape/adapters/lever.js';
import { AdapterError } from '../src/util/errors.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

class FixtureHttpClient implements HttpClient {
  public requestedUrl: string | null = null;

  public constructor(
    private readonly body: string,
    private readonly status = 200,
  ) {}

  public async fetchText(url: string): Promise<FetchResult> {
    this.requestedUrl = url;
    return { finalUrl: url, status: this.status, body: this.body, contentType: 'application/json' };
  }
}

test('Greenhouse adapter maps required fields and tolerates unknown fields', async () => {
  const http = new FixtureHttpClient(readFixture('greenhouse.json'));
  const postings = await new GreenhouseAdapter(http).fetchPostings(
    company('greenhouse', 'anthropic'),
  );

  assert.match(http.requestedUrl ?? '', /\/anthropic\/jobs\?content=true$/);
  assert.deepEqual(postings, [
    {
      title: 'Account Executive, Nonprofits & Higher Education - APAC',
      url: 'https://job-boards.greenhouse.io/anthropic/jobs/5274711008',
      location: 'Sydney, Australia',
      department: 'Sales',
      description: 'About Anthropic Build beneficial AI systems.',
      externalId: '5274711008',
    },
  ]);
});

test('Lever adapter prefers plain descriptions and tolerates unknown fields', async () => {
  const http = new FixtureHttpClient(readFixture('lever.json'));
  const postings = await new LeverAdapter(http).fetchPostings(company('lever', 'palantir'));

  assert.match(http.requestedUrl ?? '', /\/palantir\?mode=json$/);
  assert.equal(postings[0]?.title, 'Administrative Business Partner');
  assert.equal(postings[0]?.location, 'London, United Kingdom');
  assert.equal(postings[0]?.department, 'Administrative');
  assert.equal(postings[0]?.description, "A World-Changing Company\n\nSupport Palantir's teams.");
  assert.equal(postings[0]?.externalId, 'ac978161-6f46-4f6b-ad9e-a258e642751c');
});

test('adapter validation names a missing required response field', async () => {
  const http = new FixtureHttpClient(readFixture('invalid-greenhouse.json'));
  await assert.rejects(
    () => new GreenhouseAdapter(http).fetchPostings(company('greenhouse', 'example')),
    (error: unknown) =>
      error instanceof AdapterError &&
      error.message.includes('jobs.0.title') &&
      error.message.includes('Invalid input'),
  );
});

test('adapters reject non-success HTTP responses cleanly', async () => {
  const http = new FixtureHttpClient('{}', 503);
  await assert.rejects(
    () => new LeverAdapter(http).fetchPostings(company('lever', 'example')),
    (error: unknown) => error instanceof AdapterError && error.message.includes('HTTP 503'),
  );
});

function company(method: 'greenhouse' | 'lever', slug: string): CompanyRow {
  return {
    id: 1,
    name: 'Fixture Company',
    slug,
    careers_url: 'https://example.com/careers',
    tier: 'B',
    scrape_method: method,
    scraper_config: null,
    health: 'untested',
    consecutive_failures: 0,
    last_success: null,
    last_yield: null,
    created_at: '2026-07-19T00:00:00Z',
  };
}

function readFixture(fileName: string): string {
  return readFileSync(new URL(`fixtures/adapters/${fileName}`, import.meta.url), 'utf8');
}
