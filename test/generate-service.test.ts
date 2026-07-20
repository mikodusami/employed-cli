/** Verifies generation persistence, domain retry, cache stability, and AI-free degradation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DefaultAiRunner } from '../src/ai/runner.js';
import type { AiProvider, AiRequest, AiRunner, AiTask, ProviderStatus } from '../src/ai/types.js';
import { AppConfigSchema } from '../src/config/schema.js';
import { createDb, Repositories, type CompanyRow } from '../src/db/index.js';
import type { ScraperConfig } from '../src/scrape/config.js';
import { GenerateService } from '../src/services/generate.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

const fixture = readFileSync(new URL('fixtures/generated-page-1.html', import.meta.url), 'utf8');

test('known-good generated config is executed before persistence', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = insertCompany(repositories);
  const ai = new SequenceAi([goodConfig()]);
  const result = await new GenerateService(repositories, new PageHttp(fixture), ai).generateFor(
    company,
  );

  assert.equal(result.status, 'generated');
  assert.equal(result.ok, true);
  const stored = repositories.companies.findByName('Fixture');
  assert.equal(stored?.scrape_method, 'generated-static');
  assert.equal(stored?.health, 'ok');
  assert.equal(stored?.last_yield, 2);
  assert.deepEqual(JSON.parse(stored?.scraper_config ?? ''), goodConfig());
  database.close();
});

test('navigation extraction gets one domain retry then marks company broken', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = insertCompany(repositories);
  const navigation = `
    <html><body><nav>
      <a href="/about">About</a><a href="/careers">Careers</a>
      <a href="/home">Home</a><a href="/login">Login</a><a href="/search">Search</a>
    </nav></body></html>`;
  const ai = new SequenceAi([navigationConfig(), navigationConfig()]);
  const result = await new GenerateService(repositories, new PageHttp(navigation), ai).generateFor(
    company,
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.ok, false);
  assert.equal(ai.calls.length, 2);
  assert.match(ai.calls[1]?.input ?? '', /Navigation labels/i);
  const stored = repositories.companies.findByName('Fixture');
  assert.equal(stored?.health, 'broken');
  assert.equal(stored?.scraper_config, null);
  assert.equal(stored?.scrape_method, 'unknown');
  database.close();
});

test('unchanged distilled DOM reuses the provider-scoped AI cache', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = insertCompany(repositories);
  const provider = new ConfigProvider(goodConfig());
  const runner = new DefaultAiRunner(
    [provider],
    repositories,
    AppConfigSchema.parse({}).ai,
  );
  const service = new GenerateService(repositories, new PageHttp(fixture), runner);

  await service.generateFor(company);
  await service.generateFor(company);

  assert.equal(provider.calls, 1);
  database.close();
});

test('null AI runner skips generation without changing the company', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = insertCompany(repositories);
  const result = await new GenerateService(repositories, new PageHttp(fixture), null).generateFor(
    company,
  );

  assert.deepEqual(result, { status: 'skipped', ok: false, reason: 'AI unavailable.' });
  assert.deepEqual(repositories.companies.findByName('Fixture'), company);
  database.close();
});

class SequenceAi implements AiRunner {
  public readonly calls: Array<AiTask<unknown>> = [];

  public constructor(private readonly configs: ScraperConfig[]) {}

  public async runJson<Result>(task: AiTask<Result>): Promise<Result> {
    this.calls.push(task as AiTask<unknown>);
    const config = this.configs.shift();
    if (!config) {
      throw new Error('No fake AI config remains.');
    }
    return task.schema.parse(config);
  }
}

class ConfigProvider implements AiProvider {
  public readonly name = 'codex' as const;
  public calls = 0;

  public constructor(private readonly config: ScraperConfig) {}

  public async isAvailable(): Promise<ProviderStatus> {
    return { available: true, version: 'test', detail: null };
  }

  public async run(_request: AiRequest): Promise<string> {
    this.calls += 1;
    return JSON.stringify(this.config);
  }
}

class PageHttp implements HttpClient {
  public constructor(private readonly html: string) {}

  public async fetchText(url: string): Promise<FetchResult> {
    return { finalUrl: url, status: 200, body: this.html, contentType: 'text/html' };
  }

  public async postJson(): Promise<FetchResult> {
    throw new Error('Unexpected POST request.');
  }
}

function insertCompany(repositories: Repositories): CompanyRow {
  return repositories.companies.insert({
    name: 'Fixture',
    careers_url: 'https://example.com/careers',
  });
}

function goodConfig(): ScraperConfig {
  return {
    strategy: 'static',
    listSelector: 'article.job',
    fields: {
      title: { selector: 'a.role', attr: 'text' },
      url: { selector: 'a.role', attr: 'href' },
      location: { selector: '.location', attr: 'text' },
      department: null,
    },
    pagination: { type: 'none', value: null, maxPages: 1 },
    urlPrefix: null,
    confidence: 0.9,
    notes: 'Fixture config.',
  };
}

function navigationConfig(): ScraperConfig {
  return {
    ...goodConfig(),
    listSelector: 'a',
    fields: {
      title: { selector: ':scope', attr: 'text' },
      url: { selector: ':scope', attr: 'href' },
      location: null,
      department: null,
    },
  };
}
