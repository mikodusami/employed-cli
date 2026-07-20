/** Verifies company-registry rules with in-memory persistence and no network. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDb, Repositories } from '../src/db/index.js';
import { SignatureDetector } from '../src/scrape/detect.js';
import { CompanyService } from '../src/services/company.js';
import { ScrapeService } from '../src/services/scrape.js';
import { ValidationError } from '../src/util/errors.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

class FixtureHttpClient implements HttpClient {
  public async fetchText(url: string): Promise<FetchResult> {
    return {
      finalUrl: url,
      status: 200,
      body: '<html><body>Custom careers page</body></html>',
      contentType: 'text/html',
    };
  }
}

function createService(database: ReturnType<typeof createDb>): CompanyService {
  const http = new FixtureHttpClient();
  const repositories = new Repositories(database);
  return new CompanyService(
    repositories,
    new SignatureDetector(http),
    new ScrapeService(repositories, http),
  );
}

test('add inserts an untested company and detects through the injected seam', async () => {
  const database = createDb(':memory:');
  const service = createService(database);
  const result = await service.add({
    name: 'Stripe',
    url: 'https://stripe.com/jobs#openings',
    tier: 'A',
  });

  assert.equal(result.outcome, 'created');
  assert.equal(result.company.careers_url, 'https://stripe.com/jobs');
  assert.equal(result.company.scrape_method, 'unknown');
  assert.equal(result.company.health, 'untested');
  assert.equal(result.detection?.detail, 'no supported ATS signature found');
  database.close();
});

test('case-insensitive duplicate names do not insert a second company', async () => {
  const database = createDb(':memory:');
  const service = createService(database);
  await service.add({ name: 'Stripe', url: 'https://stripe.com/jobs' });
  const duplicate = await service.add({ name: 'stripe', url: 'https://example.com/jobs' });

  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal(service.list().length, 1);
  assert.equal(duplicate.company.name, 'Stripe');
  database.close();
});

test('invalid or non-web careers URLs produce typed validation errors', async () => {
  const database = createDb(':memory:');
  const service = createService(database);

  await assert.rejects(
    () => service.add({ name: 'FTP Company', url: 'ftp://example.com/jobs' }),
    ValidationError,
  );
  await assert.rejects(
    () => service.add({ name: 'Broken Company', url: 'not a URL' }),
    ValidationError,
  );
  assert.equal(service.list().length, 0);
  database.close();
});

test('batch import continues after one bad entry and reruns idempotently', async () => {
  const database = createDb(':memory:');
  const service = createService(database);
  const companiesFile = {
    defaults: { tier: 'B' as const },
    companies: [
      { name: 'Alpha', url: 'https://example.com/alpha' },
      { name: 'Malformed', url: 'ftp://example.com/jobs' },
      { name: 'Gamma', url: 'https://example.com/gamma', tier: 'A' as const },
    ],
  };

  const first = await service.importFromConfig(companiesFile);
  assert.deepEqual(
    { created: first.created, skipped: first.skipped, failed: first.failed },
    { created: 2, skipped: 0, failed: 1 },
  );
  assert.equal(first.failures[0]?.name, 'Malformed');
  assert.equal(service.list().find(({ name }) => name === 'Alpha')?.tier, 'B');
  assert.equal(service.list().find(({ name }) => name === 'Gamma')?.tier, 'A');

  const second = await service.importFromConfig({
    ...companiesFile,
    companies: companiesFile.companies.filter(({ name }) => name !== 'Malformed'),
  });
  assert.deepEqual(
    { created: second.created, skipped: second.skipped, failed: second.failed },
    { created: 0, skipped: 2, failed: 0 },
  );
  database.close();
});
