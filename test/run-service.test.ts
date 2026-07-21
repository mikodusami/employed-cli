/** Verifies the tier scheduler, run stats, lifecycle sweep, and crash-safe cleanup. */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AiRunner, AiTask } from '../src/ai/types.js';
import { AppConfigSchema, type AppConfig, type KeywordsFile } from '../src/config/schema.js';
import { createDb, Repositories, type CompanyRow } from '../src/db/index.js';
import type { AtsDetector, DetectionResult } from '../src/scrape/detect.js';
import type { ScraperConfig } from '../src/scrape/config.js';
import { RunService, selectCompaniesForRun } from '../src/services/run.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

test('run index 1 selects tier A, non-playwright tier B, and no tier C', () => {
  const companies = [
    tierCompany('A', 'greenhouse'),
    tierCompany('B', 'greenhouse'),
    tierCompany('B', 'generated-playwright'),
    tierCompany('C', 'greenhouse'),
  ];
  const selected = selectCompaniesForRun(companies, 1);
  assert.deepEqual(
    selected.map((company) => company.name),
    ['A-greenhouse', 'B-greenhouse'],
  );
});

test('run index 2 additionally selects playwright-only tier B, still no tier C', () => {
  const companies = [
    tierCompany('A', 'greenhouse'),
    tierCompany('B', 'generated-playwright'),
    tierCompany('C', 'greenhouse'),
  ];
  const selected = selectCompaniesForRun(companies, 2);
  assert.deepEqual(
    selected.map((company) => company.name),
    ['A-greenhouse', 'B-generated-playwright'],
  );
});

test('run index 3 selects tier C and drops playwright-only tier B', () => {
  const companies = [
    tierCompany('A', 'greenhouse'),
    tierCompany('B', 'generated-playwright'),
    tierCompany('C', 'greenhouse'),
  ];
  const selected = selectCompaniesForRun(companies, 3);
  assert.deepEqual(
    selected.map((company) => company.name),
    ['A-greenhouse', 'C-greenhouse'],
  );
});

test('run index 6 selects both the staggered tier B and tier C sets', () => {
  const companies = [tierCompany('B', 'generated-playwright'), tierCompany('C', 'greenhouse')];
  const selected = selectCompaniesForRun(companies, 6);
  assert.deepEqual(
    selected.map((company) => company.name),
    ['B-generated-playwright', 'C-greenhouse'],
  );
});

test('one company failing never aborts the run, and stats land in the runs row', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const reportsDirectory = mkdtempSync(path.join(tmpdir(), 'employed-reports-'));
  repositories.companies.insert({
    name: 'Good Co',
    careers_url: 'https://example.com/good',
    tier: 'A',
    scrape_method: 'greenhouse',
    slug: 'goodco',
  });
  repositories.companies.insert({
    name: 'Bad Co',
    careers_url: 'https://example.com/bad',
    tier: 'A',
    scrape_method: 'greenhouse',
  });

  const service = new RunService({
    repositories,
    http: new GreenhouseFixtureHttp(),
    detector: new UnknownDetector(),
    ai: null,
    config: baseConfig(),
    keywords: emptyKeywords(),
    reportsDirectory,
  });

  const summary = await service.execute();

  assert.equal(summary.companiesScanned, 2);
  assert.equal(summary.jobsSeen, 1);
  assert.equal(summary.jobsNew, 1);
  assert.equal(summary.aiCalls, 0);
  assert.equal(summary.failures.length, 1);
  assert.equal(summary.failures[0]?.company, 'Bad Co');
  assert.match(summary.failures[0]?.reason ?? '', /board slug/);

  const run = repositories.runs.latest();
  assert.ok(run?.finished_at);
  assert.equal(run?.companies_scanned, 2);
  assert.equal(run?.jobs_seen, 1);
  assert.equal(run?.jobs_new, 1);
  assert.equal(run?.claude_calls, 0);
  assert.deepEqual(JSON.parse(run?.failures ?? '[]'), summary.failures);

  const reportContent = readFileSync(summary.reportPath, 'utf8');
  assert.match(reportContent, /2 companies scanned/);
  assert.match(reportContent, /1 new/);
  assert.match(reportContent, /1 failures/);
  database.close();
});

test('two consecutive runs the same day are idempotent', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const reportsDirectory = mkdtempSync(path.join(tmpdir(), 'employed-reports-'));
  repositories.companies.insert({
    name: 'Good Co',
    careers_url: 'https://example.com/good',
    tier: 'A',
    scrape_method: 'greenhouse',
    slug: 'goodco',
  });
  const now = () => new Date('2026-03-01T07:00:00.000Z');
  const service = new RunService({
    repositories,
    http: new GreenhouseFixtureHttp(),
    detector: new UnknownDetector(),
    ai: null,
    config: baseConfig(),
    keywords: emptyKeywords(),
    reportsDirectory,
    now,
  });

  const first = await service.execute();
  const second = await service.execute();

  assert.equal(first.jobsNew, 1);
  assert.equal(second.jobsNew, 0);
  assert.equal(second.jobsSeen, 1);
  assert.equal(repositories.jobs.listOpen().length, 1);
  assert.equal(repositories.runs.count(), 2);
  assert.equal(first.reportPath, second.reportPath);
  database.close();
});

test('a job absent for two consecutive successful scrapes closes', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const reportsDirectory = mkdtempSync(path.join(tmpdir(), 'employed-reports-'));
  const company = repositories.companies.insert({
    name: 'Fixture',
    careers_url: 'https://example.com/fixture',
    tier: 'A',
    scrape_method: 'greenhouse',
    slug: 'goodco',
  });

  // Simulate the previous successful scrape happened well before "now".
  database
    .prepare('UPDATE companies SET health = ?, last_success = ? WHERE id = ?')
    .run('ok', '2026-01-01T00:00:00.000Z', company.id);

  // A job missing since before that previous success: this would be its second consecutive miss.
  const stale = repositories.jobs.upsert({
    company_id: company.id,
    title: 'Stale Role',
    url: 'https://example.com/jobs/stale',
    first_seen: '2025-12-20T00:00:00.000Z',
    last_seen: '2025-12-20T00:00:00.000Z',
    dedupe_key: 'stale-role',
  }).job;

  // A job that was seen exactly on the previous success: only its first miss, stays open.
  const recent = repositories.jobs.upsert({
    company_id: company.id,
    title: 'Recent Role',
    url: 'https://example.com/jobs/recent',
    first_seen: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    dedupe_key: 'recent-role',
  }).job;

  const service = new RunService({
    repositories,
    http: new GreenhouseFixtureHttp(),
    detector: new UnknownDetector(),
    ai: null,
    config: baseConfig(),
    keywords: emptyKeywords(),
    reportsDirectory,
  });

  const summary = await service.execute();

  assert.equal(summary.jobsClosed, 1);
  assert.equal(repositories.jobs.listOpen().some((job) => job.id === stale.id), false);
  assert.equal(repositories.jobs.listOpen().some((job) => job.id === recent.id), true);
  database.close();
});

test('the heal budget is shared across companies within one run, not per company', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const reportsDirectory = mkdtempSync(path.join(tmpdir(), 'employed-reports-'));
  const names = ['Alpha', 'Bravo', 'Charlie'];
  for (const name of names) {
    const company = repositories.companies.insert({
      name,
      careers_url: `https://example.com/${name.toLowerCase()}`,
      tier: 'A',
    });
    const configured = repositories.companies.updateMethod(
      company.id,
      'generated-static',
      null,
      JSON.stringify(scraperConfig('article.old')),
    );
    repositories.companies.updateHealth(configured.id, 'ok');
    repositories.companies.recordFailure(configured.id); // pre-existing first consecutive failure
  }

  const config = AppConfigSchema.parse({ run: { heal: { maxPerCompany: 2, maxPerRun: 2 } } });
  const service = new RunService({
    repositories,
    http: new HtmlHttp(changedFixtureHtml()),
    detector: new UnknownDetector(),
    ai: new ConfigAi(scraperConfig('article.new')),
    config,
    keywords: emptyKeywords(),
    reportsDirectory,
  });

  const summary = await service.execute();

  assert.equal(summary.healed, 2);
  assert.equal(summary.failures.length, 1);
  assert.match(summary.failures[0]?.reason ?? '', /budget/i);
  database.close();
});

test('--tier override bypasses the schedule for an otherwise-excluded tier', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const reportsDirectory = mkdtempSync(path.join(tmpdir(), 'employed-reports-'));
  repositories.companies.insert({
    name: 'C Tier Co',
    careers_url: 'https://example.com/c',
    tier: 'C',
    scrape_method: 'greenhouse',
    slug: 'goodco',
  });

  const service = new RunService({
    repositories,
    http: new GreenhouseFixtureHttp(),
    detector: new UnknownDetector(),
    ai: null,
    config: baseConfig(),
    keywords: emptyKeywords(),
    reportsDirectory,
  });

  const withoutOverride = await service.execute();
  assert.equal(withoutOverride.companiesScanned, 0);

  const withOverride = await service.execute({ tiers: ['C'] });
  assert.equal(withOverride.companiesScanned, 1);
  database.close();
});

test('a crash after scraping still closes the runs row in finally', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const reportsDirectory = mkdtempSync(path.join(tmpdir(), 'employed-reports-'));
  // A file, not a directory, at the reports path makes `mkdirSync` inside `writeReport` throw.
  const notADirectory = path.join(reportsDirectory, 'blocked');
  mkdirSync(reportsDirectory, { recursive: true });
  writeFileSync(notADirectory, 'not a directory');

  repositories.companies.insert({
    name: 'Good Co',
    careers_url: 'https://example.com/good',
    tier: 'A',
    scrape_method: 'greenhouse',
    slug: 'goodco',
  });

  const service = new RunService({
    repositories,
    http: new GreenhouseFixtureHttp(),
    detector: new UnknownDetector(),
    ai: null,
    config: baseConfig(),
    keywords: emptyKeywords(),
    reportsDirectory: notADirectory,
  });

  await assert.rejects(() => service.execute());

  const run = repositories.runs.latest();
  assert.ok(run?.finished_at);
  assert.equal(run?.companies_scanned, 1);
  assert.equal(run?.jobs_new, 1);
  database.close();
});

test('failed email delivery preserves the report and completes the run', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const reportsDirectory = mkdtempSync(path.join(tmpdir(), 'employed-reports-'));
  const service = new RunService({
    repositories,
    http: new GreenhouseFixtureHttp(),
    detector: new UnknownDetector(),
    ai: null,
    config: baseConfig(),
    keywords: emptyKeywords(),
    reportsDirectory,
    emailService: {
      sendDigest: () => Promise.reject(new Error('SMTP unavailable')),
    },
  });

  const summary = await service.execute({ email: true });

  assert.equal(summary.email.attempted, true);
  assert.equal(summary.email.sent, false);
  assert.match(summary.email.error ?? '', /SMTP unavailable/);
  assert.match(readFileSync(summary.reportPath, 'utf8'), /employed Daily Report/i);
  assert.ok(repositories.runs.latest()?.finished_at);
  database.close();
});

class GreenhouseFixtureHttp implements HttpClient {
  public async fetchText(url: string): Promise<FetchResult> {
    return {
      finalUrl: url,
      status: 200,
      body: readFixture('greenhouse.json'),
      contentType: 'application/json',
    };
  }

  public async postJson(): Promise<FetchResult> {
    throw new Error('Unexpected POST request.');
  }
}

class HtmlHttp implements HttpClient {
  public constructor(private readonly html: string) {}

  public async fetchText(url: string): Promise<FetchResult> {
    return { finalUrl: url, status: 200, body: this.html, contentType: 'text/html' };
  }

  public async postJson(): Promise<FetchResult> {
    throw new Error('Unexpected POST request.');
  }
}

class UnknownDetector implements AtsDetector {
  public async detect(): Promise<DetectionResult> {
    return { method: 'unknown', slug: null, detail: 'no signature' };
  }
}

class ConfigAi implements AiRunner {
  public constructor(private readonly value: ScraperConfig) {}

  public async runJson<Result>(task: AiTask<Result>): Promise<Result> {
    return task.schema.parse(this.value);
  }
}

function tierCompany(tier: 'A' | 'B' | 'C', scrapeMethod: CompanyRow['scrape_method']): CompanyRow {
  return {
    id: nextId(),
    name: `${tier}-${scrapeMethod}`,
    slug: null,
    careers_url: 'https://example.com/careers',
    tier,
    scrape_method: scrapeMethod,
    scraper_config: null,
    health: 'ok',
    consecutive_failures: 0,
    last_success: null,
    last_yield: null,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

let idCounter = 0;
function nextId(): number {
  idCounter += 1;
  return idCounter;
}

function baseConfig(): AppConfig {
  return AppConfigSchema.parse({});
}

function emptyKeywords(): KeywordsFile {
  return {
    title: {},
    description: {},
    negative: {},
    hardExclude: { title: [], description: [] },
    locations: { allow: [], block: [], allowUnknownLocation: true },
  };
}

function scraperConfig(listSelector: string): ScraperConfig {
  return {
    strategy: 'static',
    listSelector,
    fields: {
      title: { selector: 'a.role', attr: 'text' },
      url: { selector: 'a.role', attr: 'href' },
      location: null,
      department: null,
    },
    pagination: { type: 'none', value: null, maxPages: 1 },
    urlPrefix: null,
    confidence: 0.9,
    notes: 'Fixture config.',
  };
}

function changedFixtureHtml(): string {
  // Three job-like links keep `countLikelyJobLinks` at or above the generation-service
  // threshold that otherwise escalates to a real (slow) Playwright render capture.
  return `
    <html><body>
      <nav><a href="/roles">All open roles</a></nav>
      <article class="new"><a class="role" href="/roles/one">Software Engineer</a></article>
      <article class="new"><a class="role" href="/roles/two">Product Engineer</a></article>
    </body></html>`;
}

function readFixture(fileName: string): string {
  return readFileSync(new URL(`fixtures/adapters/${fileName}`, import.meta.url), 'utf8');
}
