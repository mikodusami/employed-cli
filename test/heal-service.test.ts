/** Verifies failure thresholds, repair branches, budgets, and same-run retry. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AiRunner, AiTask } from '../src/ai/types.js';
import { createDb, Repositories, type CompanyRow } from '../src/db/index.js';
import type { AtsDetector, DetectionResult } from '../src/scrape/detect.js';
import type { ScraperConfig } from '../src/scrape/config.js';
import { GenerateService, type GenerateResult } from '../src/services/generate.js';
import { HealBudget, HealService } from '../src/services/heal.js';
import { ScrapeService, type ScrapeServiceOptions, type SmokeResult } from '../src/services/scrape.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

test('simulated selector break defers once then regenerates and retries the scrape', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = generatedCompany(repositories, config('article.old'));
  const http = new HtmlHttp(changedFixture());
  const generator = new GenerateService(repositories, http, new ConfigAi(config('article.new')));
  const options: ScrapeServiceOptions = {};
  const scraper = new ScrapeService(repositories, http, options);
  options.healing = {
    service: new HealService(repositories, new FakeDetector(unknown()), scraper, generator),
    budget: new HealBudget({ maxPerCompany: 2, maxPerRun: 5 }),
  };

  const first = await scraper.scrapeCompany(company);
  assert.equal(first.status, 'failed');
  assert.equal(first.heal?.deferred, true);
  assert.equal(repositories.companies.findByName('Fixture')?.health, 'degraded');

  const degraded = repositories.companies.findByName('Fixture');
  assert.ok(degraded);
  const second = await scraper.scrapeCompany(degraded);
  assert.equal(second.status, 'completed');
  assert.equal(second.seen, 2);
  assert.equal(second.heal?.healed, true);
  const repaired = repositories.companies.findByName('Fixture');
  assert.equal(repaired?.health, 'ok');
  assert.equal(repaired?.consecutive_failures, 0);
  assert.equal(repaired?.scrape_method, 'generated-static');
  database.close();
});

test('ATS healing re-detects and smoke-tests even without AI', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const inserted = repositories.companies.insert({
    name: 'Migrated',
    careers_url: 'https://example.com/careers',
  });
  const company = repositories.companies.updateMethod(inserted.id, 'greenhouse', 'old');
  repositories.companies.updateHealth(company.id, 'ok');
  repositories.companies.recordFailure(company.id);
  const detector = new FakeDetector({ method: 'lever', slug: 'new', detail: 'fixture' });
  const smoke = new FakeSmoke(true);
  const service = new HealService(repositories, detector, smoke, null);

  const result = await service.heal(
    repositories.companies.findByName('Migrated') ?? company,
    new HealBudget({ maxPerCompany: 2, maxPerRun: 5 }),
  );

  assert.equal(result.healed, true);
  assert.equal(detector.calls, 1);
  assert.equal(smoke.calls, 1);
  assert.equal(repositories.companies.findByName('Migrated')?.scrape_method, 'lever');
  assert.equal(repositories.companies.findByName('Migrated')?.consecutive_failures, 0);
  database.close();
});

test('generated heal without AI stays degraded and failed generation becomes broken', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = generatedCompany(repositories, config('article.old'));
  repositories.companies.recordFailure(company.id);
  const current = repositories.companies.findByName('Fixture') ?? company;
  const budget = new HealBudget({ maxPerCompany: 2, maxPerRun: 5 });
  const noAi = new HealService(repositories, new FakeDetector(unknown()), new FakeSmoke(false), null);

  const skipped = await noAi.heal(current, budget);
  assert.equal(skipped.healed, false);
  assert.match(skipped.note, /AI is unavailable/);
  assert.equal(repositories.companies.findByName('Fixture')?.health, 'degraded');

  repositories.companies.updateHealth(company.id, 'ok');
  repositories.companies.recordFailure(company.id);
  const failingGenerator = {
    generateFor: async (): Promise<GenerateResult> => ({
      status: 'failed',
      ok: false,
      reasons: ['selectors still broken'],
      pendingPlaywright: false,
    }),
  } as unknown as GenerateService;
  const failure = await new HealService(
    repositories,
    new FakeDetector(unknown()),
    new FakeSmoke(false),
    failingGenerator,
  ).heal(
    repositories.companies.findByName('Fixture') ?? company,
    new HealBudget({ maxPerCompany: 2, maxPerRun: 5 }),
  );
  assert.equal(failure.healed, false);
  assert.equal(repositories.companies.findByName('Fixture')?.health, 'broken');
  database.close();
});

test('heal budget refuses a third company attempt and the sixth global heal', () => {
  const perCompany = new HealBudget({ maxPerCompany: 2, maxPerRun: 5 });
  assert.deepEqual(perCompany.consume(1), { allowed: true });
  assert.deepEqual(perCompany.consume(1), { allowed: true });
  const third = perCompany.consume(1);
  assert.equal(third.allowed, false);
  assert.match(third.allowed ? '' : third.note, /company/);

  const global = new HealBudget({ maxPerCompany: 2, maxPerRun: 5 });
  for (let companyId = 1; companyId <= 5; companyId += 1) {
    assert.deepEqual(global.consume(companyId), { allowed: true });
  }
  const sixth = global.consume(6);
  assert.equal(sixth.allowed, false);
  assert.match(sixth.allowed ? '' : sixth.note, /Global/);
});

class ConfigAi implements AiRunner {
  public constructor(private readonly value: ScraperConfig) {}

  public async runJson<Result>(task: AiTask<Result>): Promise<Result> {
    return task.schema.parse(this.value);
  }
}

class FakeDetector implements AtsDetector {
  public calls = 0;

  public constructor(private readonly result: DetectionResult) {}

  public async detect(): Promise<DetectionResult> {
    this.calls += 1;
    return this.result;
  }
}

class FakeSmoke {
  public calls = 0;

  public constructor(private readonly succeeds: boolean) {}

  public async smokeTest(company: CompanyRow): Promise<SmokeResult> {
    this.calls += 1;
    return {
      ok: this.succeeds,
      method: company.scrape_method,
      count: this.succeeds ? 2 : 0,
      reason: this.succeeds ? null : 'smoke failed',
    };
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

function generatedCompany(repositories: Repositories, scraperConfig: ScraperConfig): CompanyRow {
  const company = repositories.companies.insert({
    name: 'Fixture',
    careers_url: 'https://example.com/careers',
  });
  const configured = repositories.companies.updateMethod(
    company.id,
    'generated-static',
    null,
    JSON.stringify(scraperConfig),
  );
  return repositories.companies.updateHealth(configured.id, 'ok');
}

function config(listSelector: string): ScraperConfig {
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

function changedFixture(): string {
  return `
    <html><body>
      <article class="new"><a class="role" href="/one">Software Engineer</a></article>
      <article class="new"><a class="role" href="/two">Product Engineer</a></article>
    </body></html>`;
}

function unknown(): DetectionResult {
  return { method: 'unknown', slug: null, detail: 'no signature' };
}
