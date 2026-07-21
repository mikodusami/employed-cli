/** Verifies the iterative generated-scraper planning state machine. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Page } from 'playwright';

import { DefaultAiRunner } from '../src/ai/runner.js';
import type { AiProvider, AiRequest, AiRunner, AiTask, ProviderStatus } from '../src/ai/types.js';
import { AppConfigSchema } from '../src/config/schema.js';
import { createDb, Repositories } from '../src/db/index.js';
import { BrowserPool } from '../src/scrape/browser.js';
import type { DomPlan, ScraperPlan } from '../src/scrape/plan.js';
import { GenerateService } from '../src/services/generate.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

const fixture = readFileSync(new URL('fixtures/generated-page-1.html', import.meta.url), 'utf8');

test('a valid first plan executes before plan-v2 persistence', async () => {
  const setup = createSetup();
  const plan = goodPlan('static');
  const result = await setup.service(new SequenceAi([plan])).generateFor(setup.company);

  assert.equal(result.status, 'generated');
  assert.equal(result.status === 'generated' ? result.jobCount : null, 2);
  const stored = setup.repositories.companies.findByName('Fixture');
  assert.equal(stored?.scrape_method, 'generated-static');
  assert.equal(stored?.health, 'ok');
  assert.deepEqual(JSON.parse(stored?.scraper_config ?? ''), plan);
  setup.database.close();
});

test('validation feedback produces a different second plan and succeeds', async () => {
  const setup = createSetup();
  const ai = new SequenceAi([navigationPlan(), goodPlan('static')]);
  const result = await setup.service(ai).generateFor(setup.company);

  assert.equal(result.status, 'generated');
  assert.equal(ai.calls.length, 2);
  assert.match(ai.calls[1]?.input ?? '', /Navigation labels/i);
  setup.database.close();
});

test('unchanged evidence reuses the provider-scoped AI cache', async () => {
  const setup = createSetup();
  const provider = new PlanProvider(goodPlan('static'));
  const runner = new DefaultAiRunner(
    [provider],
    setup.repositories,
    AppConfigSchema.parse({}).ai,
  );
  const service = setup.service(runner);

  await service.generateFor(setup.company);
  await service.generateFor(setup.company);

  assert.equal(provider.calls, 1);
  setup.database.close();
});

test('null AI runner skips generation without changing the company', async () => {
  const setup = createSetup();
  const result = await setup.service(null).generateFor(setup.company);

  assert.deepEqual(result, { status: 'skipped', ok: false, reason: 'AI unavailable.' });
  assert.deepEqual(setup.repositories.companies.findByName('Fixture'), setup.company);
  setup.database.close();
});

test('sparse static evidence skips directly to network-rendered planning', async () => {
  const setup = createSetup('<html><body><div id="app"></div></body></html>');
  const browsers = new RenderedPool(fixture);
  const ai = new SequenceAi([goodPlan('playwright')]);
  const service = setup.service(ai, browsers);
  const result = await service.generateFor(setup.company);

  assert.equal(result.status, 'generated');
  assert.equal(result.status === 'generated' ? result.strategy : null, 'playwright');
  assert.equal(ai.calls.length, 1);
  assert.equal(browsers.borrows, 2);
  setup.database.close();
});

test('four failed plans produce a complete diagnostics bundle and manual review health', async () => {
  const navigation = `
    <nav>
      <a href="/jobs">Careers</a><a href="/jobs/open">Openings</a>
      <a href="/positions">Positions</a><a href="/about">About</a><a href="/login">Login</a>
    </nav>`;
  const setup = createSetup(navigation);
  const ai = new SequenceAi(Array.from({ length: 4 }, () => navigationPlan()));
  const result = await setup.service(ai, new RenderedPool(navigation)).generateFor(setup.company);

  assert.equal(result.status, 'failed');
  assert.equal(ai.calls.length, 4);
  assert.equal(setup.repositories.companies.findByName('Fixture')?.health, 'manual-review');
  if (result.status === 'failed') {
    assert.equal(existsSync(path.join(result.diagnosticsPath, 'captured.html')), true);
    assert.equal(existsSync(path.join(result.diagnosticsPath, 'network.txt')), true);
    assert.equal(existsSync(path.join(result.diagnosticsPath, 'attempts.json')), true);
    assert.equal(existsSync(path.join(result.diagnosticsPath, 'navigation.json')), true);
  }
  setup.database.close();
});

class SequenceAi implements AiRunner {
  public readonly calls: Array<AiTask<unknown>> = [];

  public constructor(private readonly plans: ScraperPlan[]) {}

  public async runJson<Result>(task: AiTask<Result>): Promise<Result> {
    this.calls.push(task as AiTask<unknown>);
    const plan = this.plans.shift();
    if (!plan) {
      throw new Error('No fake AI plan remains.');
    }
    return task.schema.parse(plan);
  }
}

class PlanProvider implements AiProvider {
  public readonly name = 'codex' as const;
  public calls = 0;

  public constructor(private readonly plan: ScraperPlan) {}

  public async isAvailable(): Promise<ProviderStatus> {
    return { available: true, version: 'test', detail: null };
  }

  public async run(_request: AiRequest): Promise<string> {
    this.calls += 1;
    return JSON.stringify(this.plan);
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

class RenderedPool extends BrowserPool {
  public borrows = 0;

  public constructor(private readonly html: string) {
    super();
  }

  public override async page<Result>(operation: (page: Page) => Promise<Result>): Promise<Result> {
    this.borrows += 1;
    let currentUrl = 'https://example.com/careers';
    const page = {
      on: () => undefined,
      goto: async (url: string) => {
        currentUrl = url;
        return null;
      },
      content: async () => this.html,
      waitForSelector: async () => ({}),
      waitForLoadState: async () => undefined,
      waitForTimeout: async () => undefined,
      evaluate: async () => undefined,
      locator: () => ({
        first: () => ({
          count: async () => 0,
          isVisible: async () => false,
          click: async () => undefined,
          getAttribute: async () => null,
        }),
      }),
      url: () => currentUrl,
    } as unknown as Page;
    return operation(page);
  }
}

function createSetup(html = fixture) {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = repositories.companies.insert({
    name: 'Fixture',
    careers_url: 'https://example.com/careers',
  });
  const diagnosticsDirectory = mkdtempSync(path.join(tmpdir(), 'employed-generate-'));
  return {
    database,
    repositories,
    company,
    service: (ai: AiRunner | null, browsers?: BrowserPool) =>
      new GenerateService(repositories, new PageHttp(html), ai, browsers, {
        diagnosticsDirectory,
      }),
  };
}

function goodPlan(strategy: DomPlan['strategy']): DomPlan {
  return {
    mode: 'dom',
    planVersion: 2,
    strategy,
    navigate: [],
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
    notes: 'Fixture plan.',
  };
}

function navigationPlan(): DomPlan {
  return {
    ...goodPlan('static'),
    listSelector: 'a',
    fields: {
      title: { selector: ':scope', attr: 'text' },
      url: { selector: ':scope', attr: 'href' },
      location: null,
      department: null,
    },
  };
}
