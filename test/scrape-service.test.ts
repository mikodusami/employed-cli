/** Verifies transactional scraping, dedupe, health, skip, and failure containment. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createDb, Repositories } from '../src/db/index.js';
import { ScrapeService } from '../src/services/scrape.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

class FixtureHttpClient implements HttpClient {
  public constructor(
    private readonly body: string,
    private readonly status = 200,
  ) {}

  public async fetchText(url: string): Promise<FetchResult> {
    return { finalUrl: url, status: this.status, body: this.body, contentType: 'application/json' };
  }
}

test('scrapeCompany inserts once then refreshes the same posting on rerun', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = createCompany(repositories, 'greenhouse', 'anthropic');
  const service = new ScrapeService(
    repositories,
    new FixtureHttpClient(readFixture('greenhouse.json')),
  );

  const first = await service.scrapeCompany(company);
  const second = await service.scrapeCompany(company);
  assert.deepEqual(
    { status: first.status, seen: first.seen, new: first.new },
    { status: 'completed', seen: 1, new: 1 },
  );
  assert.deepEqual(
    { status: second.status, seen: second.seen, new: second.new },
    { status: 'completed', seen: 1, new: 0 },
  );
  assert.equal(repositories.jobs.findNewSince('2000-01-01').length, 1);
  assert.equal(repositories.companies.findByName('Fixture Company')?.last_yield, 1);
  database.close();
});

test('scrapeCompany returns a typed skipped result when no adapter exists', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = createCompany(repositories, 'unknown', 'not-built-yet');
  const result = await new ScrapeService(repositories, new FixtureHttpClient('')).scrapeCompany(
    company,
  );

  assert.equal(result.status, 'skipped');
  assert.match(result.reason ?? '', /No source for unknown/);
  database.close();
});

test('adapter failures increment company failures and return without throwing', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = createCompany(repositories, 'lever', 'garbage-slug');
  const service = new ScrapeService(repositories, new FixtureHttpClient('{}', 404));
  const result = await service.scrapeCompany(company);

  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /HTTP 404/);
  assert.equal(repositories.companies.findByName('Fixture Company')?.consecutive_failures, 1);
  database.close();
});

test('smokeTest marks a yielding adapter healthy and records its count', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = createCompany(repositories, 'lever', 'palantir');
  const service = new ScrapeService(
    repositories,
    new FixtureHttpClient(readFixture('lever.json')),
  );
  const result = await service.smokeTest(company);
  const updated = repositories.companies.findByName('Fixture Company');

  assert.deepEqual(result, { ok: true, method: 'lever', count: 1, reason: null });
  assert.equal(updated?.health, 'ok');
  assert.equal(updated?.last_yield, 1);
  assert.equal(updated?.consecutive_failures, 0);
  database.close();
});

function createCompany(
  repositories: Repositories,
  method: 'greenhouse' | 'lever' | 'ashby' | 'unknown',
  slug: string,
) {
  const company = repositories.companies.insert({
    name: 'Fixture Company',
    careers_url: 'https://example.com/careers',
  });
  return repositories.companies.updateMethod(company.id, method, slug);
}

function readFixture(fileName: string): string {
  return readFileSync(new URL(`fixtures/adapters/${fileName}`, import.meta.url), 'utf8');
}
