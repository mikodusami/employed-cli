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
    {
      keywords: {
        title: { 'account executive': 5 },
        description: { ai: 2 },
        negative: { apac: 1 },
        hardExclude: { title: [], description: [] },
        locations: { allow: [], block: [], allowUnknownLocation: true },
      },
    },
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
  const scored = repositories.jobs.findNewSince('2000-01-01')[0];
  assert.equal(scored?.score, 10);
  assert.equal(scored?.band, 'C');
  assert.deepEqual(JSON.parse(scored?.matched_kw ?? ''), ['account executive', 'ai', 'apac']);
  assert.equal(first.newJobs[0]?.score, 10);
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

test('a hard-excluded posting is stored dismissed with a reason, not surfaced as new', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = createCompany(repositories, 'greenhouse', 'anthropic');
  const service = new ScrapeService(
    repositories,
    new FixtureHttpClient(readFixture('greenhouse.json')),
    {
      keywords: {
        title: {},
        description: {},
        negative: {},
        hardExclude: { title: ['account executive'], description: [] },
        locations: { allow: [], block: [], allowUnknownLocation: true },
      },
    },
  );

  const result = await service.scrapeCompany(company);

  assert.equal(result.status, 'completed');
  assert.equal(result.seen, 1, 'excluded postings still count toward seen');
  assert.equal(result.new, 0, 'excluded postings never surface as new');
  assert.deepEqual(result.newJobs, []);
  assert.equal(result.autoFiltered, 1);
  assert.equal(result.autoFilteredByKeyword, 1);
  assert.equal(result.autoFilteredByLocation, 0);

  const stored = repositories.jobs.findNewSince('2000-01-01')[0];
  assert.equal(stored?.status, 'dismissed');
  assert.match(stored?.filter_reason ?? '', /hard-exclude title: account executive/);
  database.close();
});

test('a location-blocked posting counts toward the location bucket', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = createCompany(repositories, 'greenhouse', 'anthropic');
  const service = new ScrapeService(
    repositories,
    new FixtureHttpClient(readFixture('greenhouse.json')),
    {
      keywords: {
        title: {},
        description: {},
        negative: {},
        hardExclude: { title: [], description: [] },
        locations: { allow: [], block: ['australia'], allowUnknownLocation: true },
      },
    },
  );

  const result = await service.scrapeCompany(company);

  assert.equal(result.autoFiltered, 1);
  assert.equal(result.autoFilteredByKeyword, 0);
  assert.equal(result.autoFilteredByLocation, 1);
  const stored = repositories.jobs.findNewSince('2000-01-01')[0];
  assert.match(stored?.filter_reason ?? '', /location blocked: australia/);
  database.close();
});

test('a dismissed job is never silently revived or re-labeled by a later scrape', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = createCompany(repositories, 'greenhouse', 'anthropic');
  const excludingKeywords = {
    title: {},
    description: {},
    negative: {},
    hardExclude: { title: ['account executive'], description: [] },
    locations: { allow: [], block: [], allowUnknownLocation: true },
  };
  const permissiveKeywords = {
    title: {},
    description: {},
    negative: {},
    hardExclude: { title: [], description: [] },
    locations: { allow: [], block: [], allowUnknownLocation: true },
  };

  const http = new FixtureHttpClient(readFixture('greenhouse.json'));
  await new ScrapeService(repositories, http, { keywords: excludingKeywords }).scrapeCompany(
    company,
  );
  const filtered = repositories.jobs.findNewSince('2000-01-01')[0];
  assert.equal(filtered?.status, 'dismissed');

  // Simulate the user removing the hard-exclude term and re-scraping: the already-filtered job
  // must stay exactly as it was — only `restore` reopens it.
  await new ScrapeService(repositories, http, { keywords: permissiveKeywords }).scrapeCompany(
    company,
  );
  const stillFiltered = repositories.jobs.findNewSince('2000-01-01')[0];
  assert.equal(stillFiltered?.status, 'dismissed');
  assert.match(stillFiltered?.filter_reason ?? '', /hard-exclude title: account executive/);
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
