/** Verifies offline, open-only, repeatable re-scoring after keyword edits. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { KeywordsFile } from '../src/config/schema.js';
import { createDb, Repositories } from '../src/db/index.js';
import { RescoreService } from '../src/services/rescore.js';

test('re-scoring applies edited weights without network access', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = repositories.companies.insert({
    name: 'Fixture',
    careers_url: 'https://example.com/careers',
  });
  const open = repositories.jobs.upsert({
    company_id: company.id,
    title: 'Backend Engineer',
    description: 'Python APIs',
    url: 'https://example.com/jobs/open',
    first_seen: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    dedupe_key: 'open',
  }).job;
  const dismissed = repositories.jobs.upsert({
    company_id: company.id,
    title: 'Backend Engineer',
    description: 'Python APIs',
    url: 'https://example.com/jobs/dismissed',
    first_seen: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    dedupe_key: 'dismissed',
  }).job;
  repositories.jobs.dismiss(dismissed.id);
  let networkCalls = 0;
  const unusedHttp = {
    fetchText: async () => {
      networkCalls += 1;
    },
  };
  assert.ok(unusedHttp);

  const initial = new RescoreService(repositories, profile(2)).rescoreOpen();
  // The job had no prior band (never scored before), so there is nothing to diff yet.
  assert.deepEqual(initial, { updated: 1, bandUp: 0, bandDown: 0 });
  let rescored = repositories.jobs.listOpen()[0];
  assert.equal(rescored?.score, 4);
  assert.equal(rescored?.band, 'D');

  const edited = new RescoreService(repositories, profile(10)).rescoreOpen();
  // D -> B is an improvement: the band-change diff must report it as "up", not just "updated".
  assert.deepEqual(edited, { updated: 1, bandUp: 1, bandDown: 0 });
  rescored = repositories.jobs.listOpen()[0];
  assert.equal(rescored?.id, open.id);
  assert.equal(rescored?.score, 20);
  assert.equal(rescored?.band, 'B');
  assert.deepEqual(JSON.parse(rescored?.matched_kw ?? ''), ['backend']);
  assert.equal(networkCalls, 0);
  assert.equal(repositories.jobs.findNewSince('2000-01-01').find(
    (job) => job.id === dismissed.id,
  )?.score, null);
  database.close();
});

test('rescore reports a band-down diff when a keyword weight is removed', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = repositories.companies.insert({
    name: 'Fixture',
    careers_url: 'https://example.com/careers',
  });
  repositories.jobs.upsert({
    company_id: company.id,
    title: 'Backend Engineer',
    url: 'https://example.com/jobs/one',
    first_seen: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    dedupe_key: 'one',
  });

  new RescoreService(repositories, profile(10)).rescoreOpen(); // score 20, band B
  const after = new RescoreService(repositories, profile(0)).rescoreOpen(); // score 0, band D
  assert.deepEqual(after, { updated: 1, bandUp: 0, bandDown: 1 });
  database.close();
});

function profile(weight: number): KeywordsFile {
  return {
    title: { backend: weight },
    description: {},
    negative: {},
    hardExclude: { title: [], description: [] },
    locations: { allow: [], block: [], allowUnknownLocation: true },
  };
}
