/** Verifies lossless export and safe, idempotent legacy migration. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDb, Repositories } from '../src/db/index.js';
import { ExportService } from '../src/services/export.js';
import { ImportHqService } from '../src/services/import-hq.js';

test('native JSON export round-trips every core row into a fresh database', () => {
  const sourceDb = createDb(':memory:');
  const source = new Repositories(sourceDb);
  seedCoreRows(source);
  const snapshot = new ExportService(source, () => new Date('2026-07-20T12:00:00Z')).exportJson();
  const targetDb = createDb(':memory:');
  const target = new Repositories(targetDb);
  const importer = importerFor(target);

  const first = importer.import(snapshot);
  const second = importer.import(snapshot);
  const restored = new ExportService(target, () => new Date(snapshot.exportedAt)).exportJson();

  assert.deepEqual(restored, snapshot);
  assert.deepEqual(first.native, { companies: 1, jobs: 1 });
  assert.equal(first.applications.created, 1);
  assert.deepEqual(second.native, { companies: 0, jobs: 0 });
  assert.equal(second.applications.skipped, 1);
  sourceDb.close();
  targetDb.close();
});

test('CSV quotes spreadsheet-sensitive values and has stable application columns', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  repositories.applications.create(
    { company_name: 'Example, Inc.', role: 'Engineer "I"', notes: 'first\nline' },
    '2026-07-20T12:00:00Z',
  );

  const csv = new ExportService(repositories).exportCsv('applications');

  assert.match(csv, /^id,job_id,company_name,role,status,/);
  assert.match(csv, /"Example, Inc\."/);
  assert.match(csv, /"Engineer ""I"""/);
  assert.match(csv, /"first\nline"/);
  database.close();
});

test('HQ dry-run writes nothing; commit synthesizes events and rerun skips everything', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const keywordsPath = keywordFile();
  const importer = importerFor(repositories, keywordsPath);
  const backup = {
    apps: [{ company: 'Acme', role: 'Engineer', status: 'interview', appliedAt: '2026-07-01' }],
    scoring: { title: { platform: 4 }, desc: { kubernetes: 2 } },
    seen: ['thread-1'],
  };

  const dryRun = importer.import(backup, { dryRun: true });
  assert.equal(dryRun.applications.created, 1);
  assert.equal(repositories.applications.list().length, 0);
  assert.doesNotMatch(readFileSync(keywordsPath, 'utf8'), /platform/);

  const first = importer.import(backup);
  const application = repositories.applications.list()[0];
  assert.ok(application);
  assert.equal(first.eventsCreated, 2);
  assert.deepEqual(
    repositories.events.listForApplication(application.id).map((event) => event.type),
    ['applied', 'interview'],
  );
  assert.match(repositories.events.listForApplication(application.id)[0]?.note ?? '', /Imported/);
  assert.equal(repositories.emailThreads.isSeen('thread-1'), true);
  assert.match(readFileSync(keywordsPath, 'utf8'), /platform: 4/);

  const second = importer.import(backup);
  assert.equal(second.applications.created, 0);
  assert.equal(second.applications.skipped, 1);
  assert.equal(second.threads.created, 0);
  assert.equal(repositories.events.list().length, 2);
  database.close();
});

test('malformed HQ input leaves every dataset untouched', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const importer = importerFor(repositories);

  assert.throws(() => importer.import({ apps: [{ role: 'Missing company' }] }));
  assert.equal(repositories.applications.list().length, 0);
  assert.equal(repositories.events.list().length, 0);
  database.close();
});

function seedCoreRows(repositories: Repositories): void {
  const company = repositories.companies.insert({
    name: 'Acme', careers_url: 'https://example.com/jobs', tier: 'A',
  });
  const job = repositories.jobs.upsert({
    company_id: company.id, dedupe_key: 'job-1', title: 'Engineer',
    url: 'https://example.com/jobs/1', first_seen: '2026-07-20', last_seen: '2026-07-20',
    score: 35, band: 'A', matched_kw: '["engineer"]',
  }).job;
  const application = repositories.applications.create(
    { job_id: job.id, company_name: 'Acme', role: 'Engineer', applied_at: '2026-07-20' },
    '2026-07-20',
  );
  repositories.events.append({
    application_id: application.id, at: '2026-07-20', type: 'applied', note: null,
  });
}

function importerFor(repositories: Repositories, keywordsPath = keywordFile()): ImportHqService {
  return new ImportHqService({
    repositories,
    currentKeywords: { title: {}, description: {}, negative: {} },
    keywordsPath,
    now: () => new Date('2026-07-20T12:00:00Z'),
  });
}

function keywordFile(): string {
  const filePath = path.join(mkdtempSync(path.join(tmpdir(), 'employed-portability-')), 'keywords.yaml');
  writeFileSync(filePath, 'title: {}\ndescription: {}\nnegative: {}\n');
  return filePath;
}
