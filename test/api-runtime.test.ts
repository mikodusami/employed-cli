/** Verifies hidden-API execution, pagination termination, and host safety. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { CompanyRow } from '../src/db/index.js';
import type { ApiPlan } from '../src/scrape/plan.js';
import { ApiExecutor } from '../src/scrape/runtime/api.js';
import { AdapterError } from '../src/util/errors.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

test('API executor maps dot paths and stops offset pagination at total', async () => {
  const http = new JsonHttp([
    { data: { jobs: [{ name: 'Engineer', id: 7, city: 'NYC' }], total: 2 } },
    { data: { jobs: [{ name: 'Designer', id: 8, city: 'Remote' }], total: 2 } },
  ]);
  const report = await new ApiExecutor(http, apiPlan('offset')).execute(company());

  assert.equal(report.requestCount, 2);
  assert.equal(report.pageCount, 2);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.postings, [
    {
      title: 'Engineer',
      url: 'https://example.com/jobs/7',
      location: 'NYC',
      department: null,
      externalId: '7',
    },
    {
      title: 'Designer',
      url: 'https://example.com/jobs/8',
      location: 'Remote',
      department: null,
      externalId: '8',
    },
  ]);
  assert.deepEqual(http.urls, [
    'https://api.example.com/jobs?offset=0',
    'https://api.example.com/jobs?offset=1',
  ]);
});

test('API executor supports page pagination and rejects an unrelated host before HTTP', async () => {
  const http = new JsonHttp([{ data: { jobs: [], total: 0 } }]);
  const pagePlan = apiPlan('page');
  pagePlan.request.urlTemplate = 'https://api.example.com/jobs?page={page}';
  await new ApiExecutor(http, pagePlan).execute(company());
  assert.deepEqual(http.urls, ['https://api.example.com/jobs?page=1']);

  const unsafe = apiPlan('none');
  unsafe.request.urlTemplate = 'https://attacker.invalid/collect';
  await assert.rejects(() => new ApiExecutor(http, unsafe).execute(company()), AdapterError);
  assert.equal(http.urls.length, 1);
});

class JsonHttp implements HttpClient {
  public readonly urls: string[] = [];

  public constructor(private readonly pages: unknown[]) {}

  public async fetchText(url: string): Promise<FetchResult> {
    this.urls.push(url);
    return {
      finalUrl: url,
      status: 200,
      body: JSON.stringify(this.pages.shift() ?? { data: { jobs: [] } }),
      contentType: 'application/json',
    };
  }

  public async postJson(url: string): Promise<FetchResult> {
    return this.fetchText(url);
  }
}

function apiPlan(type: ApiPlan['pagination']['type']): ApiPlan {
  return {
    mode: 'api',
    planVersion: 2,
    request: {
      method: 'GET',
      urlTemplate: 'https://api.example.com/jobs?offset={offset}',
      bodyTemplate: null,
      headers: { accept: 'application/json' },
    },
    response: {
      itemsPath: 'data.jobs',
      fields: {
        title: 'name',
        url: 'id',
        location: 'city',
        department: null,
        externalId: 'id',
      },
      urlPrefix: 'https://example.com/jobs/',
      totalPath: 'data.total',
    },
    pagination: { type, pageSize: 1, maxPages: 25 },
    confidence: 0.95,
    notes: 'Recorded JSON fixture.',
  };
}

function company(): CompanyRow {
  return {
    id: 1,
    name: 'Fixture',
    slug: null,
    careers_url: 'https://careers.example.com',
    tier: 'B',
    scrape_method: 'unknown',
    scraper_config: null,
    health: 'untested',
    consecutive_failures: 0,
    last_success: null,
    last_yield: null,
    created_at: new Date().toISOString(),
  };
}
