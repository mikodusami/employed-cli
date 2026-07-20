/** Verifies all Tier-1 adapter mappings against compact recorded API responses. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { CompanyRow, ScrapeMethod } from '../src/db/index.js';
import { AshbyAdapter } from '../src/scrape/adapters/ashby.js';
import { GreenhouseAdapter } from '../src/scrape/adapters/greenhouse.js';
import { LeverAdapter } from '../src/scrape/adapters/lever.js';
import { RecruiteeAdapter } from '../src/scrape/adapters/recruitee.js';
import { SmartRecruitersAdapter } from '../src/scrape/adapters/smartrecruiters.js';
import { WorkdayAdapter } from '../src/scrape/adapters/workday.js';
import { decodeWorkdaySlug, encodeWorkdaySlug } from '../src/scrape/slug.js';
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

  public async postJson(url: string): Promise<FetchResult> {
    this.requestedUrl = url;
    return { finalUrl: url, status: this.status, body: this.body, contentType: 'application/json' };
  }
}

class SequenceHttpClient implements HttpClient {
  public readonly requests: Array<{ url: string; body: unknown }> = [];
  private responseIndex = 0;

  public constructor(private readonly bodies: readonly string[]) {}

  public async fetchText(url: string): Promise<FetchResult> {
    return this.respond(url, null);
  }

  public async postJson(url: string, body: unknown): Promise<FetchResult> {
    return this.respond(url, body);
  }

  private respond(url: string, body: unknown): FetchResult {
    this.requests.push({ url, body });
    const responseBody = this.bodies[Math.min(this.responseIndex, this.bodies.length - 1)] ?? '{}';
    this.responseIndex += 1;
    return { finalUrl: url, status: 200, body: responseBody, contentType: 'application/json' };
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

test('Ashby adapter maps URL and description fallbacks', async () => {
  const http = new FixtureHttpClient(readFixture('ashby.json'));
  const postings = await new AshbyAdapter(http).fetchPostings(company('ashby', 'example'));

  assert.equal(postings.length, 2);
  assert.equal(postings[0]?.department, 'Engineering');
  assert.equal(postings[0]?.description, 'Build reliable products.');
  assert.equal(postings[1]?.url, 'https://jobs.ashbyhq.com/example/ashby-102/application');
  assert.equal(postings[1]?.description, 'Shape the roadmap.');
});

test('SmartRecruiters adapter maps title-only postings', async () => {
  const http = new FixtureHttpClient(readFixture('smartrecruiters.json'));
  const postings = await new SmartRecruitersAdapter(http).fetchPostings(
    company('smartrecruiters', 'Visa'),
  );

  assert.equal(postings.length, 2);
  assert.equal(postings[0]?.location, 'Austin, US');
  assert.equal(postings[0]?.department, 'Technology');
  assert.equal(postings[0]?.description, null);
  assert.equal(postings[0]?.url, 'https://jobs.smartrecruiters.com/Visa/sr-201');
});

test('Recruitee adapter maps offers and strips HTML', async () => {
  const http = new FixtureHttpClient(readFixture('recruitee.json'));
  const postings = await new RecruiteeAdapter(http).fetchPostings(
    company('recruitee', 'example'),
  );

  assert.equal(postings.length, 2);
  assert.equal(postings[0]?.description, 'Learn and ship software.');
  assert.equal(postings[1]?.department, 'Product');
  assert.equal(postings[1]?.externalId, '302');
});

test('Workday adapter concatenates pages through an empty terminator', async () => {
  const http = new SequenceHttpClient([
    readFixture('workday-page-1.json'),
    readFixture('workday-page-2.json'),
    readFixture('workday-empty.json'),
  ]);
  const postings = await new WorkdayAdapter(http, 0).fetchPostings(
    company('workday', 'example|wd1|Careers'),
  );

  assert.equal(postings.length, 3);
  assert.equal(http.requests.length, 3);
  assert.deepEqual(http.requests.map((request) => request.body), [
    { limit: 20, offset: 0, searchText: '' },
    { limit: 20, offset: 20, searchText: '' },
    { limit: 20, offset: 40, searchText: '' },
  ]);
  assert.equal(postings[0]?.externalId, 'JR-1001');
  assert.equal(
    postings[0]?.url,
    'https://example.wd1.myworkdayjobs.com/Careers/job/New-York/Software-Engineer-I_JR-1001',
  );
  assert.equal(postings[0]?.description, null);
});

test('all new adapters name missing required response fields', async () => {
  const cases = [
    () => new AshbyAdapter(new FixtureHttpClient('{"jobs":[{"id":"1"}]}')).fetchPostings(
      company('ashby', 'example'),
    ),
    () => new SmartRecruitersAdapter(
      new FixtureHttpClient('{"content":[{"id":"1"}],"totalFound":1,"limit":100,"offset":0}'),
    ).fetchPostings(company('smartrecruiters', 'Example')),
    () => new RecruiteeAdapter(
      new FixtureHttpClient('{"offers":[{"id":"1","title":"Role"}]}'),
    ).fetchPostings(company('recruitee', 'example')),
    () => new WorkdayAdapter(
      new FixtureHttpClient('{"total":1,"jobPostings":[{"externalPath":"/job/1"}]}'),
      0,
    ).fetchPostings(company('workday', 'example|wd1|Careers')),
  ];

  for (const run of cases) {
    await assert.rejects(run, (error: unknown) => error instanceof AdapterError);
  }
});

test('Workday slug codec round-trips and rejects garbage before HTTP', async () => {
  const encoded = encodeWorkdaySlug({ tenant: 'example', instance: 'WD12', site: 'Careers' });
  assert.equal(encoded, 'example|wd12|Careers');
  assert.deepEqual(decodeWorkdaySlug(encoded), {
    tenant: 'example',
    instance: 'wd12',
    site: 'Careers',
  });
  assert.throws(() => decodeWorkdaySlug('garbage'), AdapterError);

  const http = new SequenceHttpClient(['{}']);
  await assert.rejects(
    () => new WorkdayAdapter(http, 0).fetchPostings(company('workday', 'garbage')),
    AdapterError,
  );
  assert.equal(http.requests.length, 0);
});

test('Workday adapter caps a synthetic infinite response at 25 pages', async () => {
  const infinitePage = JSON.stringify({
    total: 9999,
    jobPostings: [
      { title: 'Role', externalPath: '/job/Role_JR-9999', locationsText: 'Remote' },
    ],
  });
  const http = new SequenceHttpClient([infinitePage]);
  const postings = await new WorkdayAdapter(http, 0).fetchPostings(
    company('workday', 'example|wd1|Careers'),
  );

  assert.equal(http.requests.length, 25);
  assert.equal(postings.length, 25);
});

function company(method: ScrapeMethod, slug: string): CompanyRow {
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
