/** Verifies versioned plan discrimination and enforced declarative safety limits. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ScraperPlanSchema } from '../src/scrape/plan.js';

test('plan v2 round-trips DOM and API modes', () => {
  const dom = ScraperPlanSchema.parse({
    mode: 'dom',
    planVersion: 2,
    strategy: 'static',
    listSelector: '.job',
    fields: {
      title: { selector: 'a', attr: 'text' },
      url: { selector: 'a', attr: 'href' },
      location: null,
      department: null,
    },
    pagination: { type: 'none', value: null, maxPages: 1 },
    urlPrefix: null,
    confidence: 0.8,
    notes: 'fixture',
  });
  assert.deepEqual(dom.navigate, []);

  const api = ScraperPlanSchema.parse({
    mode: 'api',
    planVersion: 2,
    request: {
      method: 'GET',
      urlTemplate: 'https://example.com/jobs',
      bodyTemplate: null,
    },
    response: {
      itemsPath: 'jobs',
      fields: {
        title: 'title',
        url: 'url',
        location: null,
        department: null,
        externalId: null,
      },
      urlPrefix: null,
      totalPath: null,
    },
    pagination: { type: 'none' },
    confidence: 0.9,
    notes: 'fixture',
  });
  assert.deepEqual(api.pagination, { type: 'none', pageSize: 20, maxPages: 10 });
  assert.deepEqual(api.request.headers, {});
});

test('plan v2 rejects executable headers, excess navigation, and page caps', () => {
  const result = ScraperPlanSchema.safeParse({
    mode: 'api',
    planVersion: 2,
    request: {
      method: 'GET',
      urlTemplate: 'https://example.com/jobs',
      bodyTemplate: null,
      headers: { authorization: 'secret' },
    },
    response: {
      itemsPath: 'jobs',
      fields: { title: 'title', url: 'url', location: null, department: null, externalId: null },
      urlPrefix: null,
      totalPath: null,
    },
    pagination: { type: 'page', pageSize: 20, maxPages: 26 },
    confidence: 1,
    notes: '',
  });
  assert.equal(result.success, false);
  assert.match(result.error?.message ?? '', /authorization|maxPages/);
});
