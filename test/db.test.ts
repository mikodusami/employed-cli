/** Verifies SQLite migration, constraints, transactions, and repository behavior. */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createDb, Repositories, withTransaction } from '../src/db/index.js';
import { migrate, type Migration } from '../src/db/migrate.js';

test('fresh database contains seven tables with foreign keys and WAL enabled', () => {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), 'employed-db-'));
  const database = createDb(path.join(baseDirectory, 'employed.db'));
  const tables = database
    .prepare<[], { name: string }>(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)
    .all()
    .map(({ name }) => name);

  assert.deepEqual(tables, [
    'ai_cache',
    'applications',
    'companies',
    'email_threads',
    'events',
    'jobs',
    'runs',
  ]);
  assert.equal(database.pragma('user_version', { simple: true }), 1);
  assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(database.pragma('journal_mode', { simple: true }), 'wal');
  const companyColumns = database
    .pragma('table_info(companies)')
    .map((column) => (column as { name: string }).name);
  assert.deepEqual(companyColumns, [
    'id',
    'name',
    'slug',
    'careers_url',
    'tier',
    'scrape_method',
    'scraper_config',
    'health',
    'consecutive_failures',
    'last_success',
    'last_yield',
    'created_at',
  ]);

  migrate(database);
  assert.equal(database.pragma('user_version', { simple: true }), 1);
  database.close();
});

test('company repository round-trips and tracks scraper outcomes', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const inserted = repositories.companies.insert({
    name: 'Orbit Works',
    tier: 'A',
    careers_url: 'https://example.com/careers',
  });

  assert.deepEqual(repositories.companies.findByName('Orbit Works'), inserted);
  assert.equal(repositories.companies.recordFailure(inserted.id).consecutive_failures, 1);
  const recovered = repositories.companies.recordSuccess(inserted.id, 12);
  assert.equal(recovered.consecutive_failures, 0);
  assert.equal(recovered.last_yield, 12);
  assert.equal(recovered.health, 'ok');
  database.close();
});

test('job upsert preserves first_seen and refreshes last_seen on dedupe conflict', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = repositories.companies.insert({
    name: 'Nova Systems',
    tier: 'B',
    careers_url: 'https://example.com/jobs',
  });
  const input = {
    company_id: company.id,
    title: 'Software Engineer',
    url: 'https://example.com/jobs/42',
    first_seen: '2026-07-18T07:00:00Z',
    last_seen: '2026-07-18T07:00:00Z',
    dedupe_key: 'known-key',
  };

  const first = repositories.jobs.upsert(input);
  const second = repositories.jobs.upsert({ ...input, last_seen: '2026-07-19T07:00:00Z' });
  assert.equal(first.isNew, true);
  assert.equal(second.isNew, false);
  assert.equal(second.job.first_seen, first.job.first_seen);
  assert.equal(second.job.last_seen, '2026-07-19T07:00:00Z');
  database.close();
});

test('foreign-key enforcement rejects a job for an unknown company', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  assert.throws(() =>
    repositories.jobs.upsert({
      company_id: 999,
      title: 'Impossible Job',
      url: 'https://example.com/jobs/missing',
      first_seen: '2026-07-19T07:00:00Z',
      last_seen: '2026-07-19T07:00:00Z',
      dedupe_key: 'missing-company',
    }),
  );
  database.close();
});

test('failed migration rolls back schema changes and user_version', () => {
  const database = new Database(':memory:');
  const failingPlan: readonly Migration[] = [
    {
      version: 1,
      up: (migrationDatabase) => {
        migrationDatabase.exec('CREATE TABLE should_rollback (id INTEGER PRIMARY KEY)');
        throw new Error('deliberate migration failure');
      },
    },
  ];

  assert.throws(() => migrate(database, failingPlan), /deliberate migration failure/);
  assert.equal(database.pragma('user_version', { simple: true }), 0);
  const table = database
    .prepare<[], { name: string }>("SELECT name FROM sqlite_schema WHERE name = 'should_rollback'")
    .get();
  assert.equal(table, undefined);
  database.close();
});

test('service transaction wrapper commits or rolls back repository calls as one unit', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  assert.throws(() =>
    withTransaction(database, () => {
      repositories.companies.insert({
        name: 'Rollback Incorporated',
        tier: 'C',
        careers_url: 'https://example.com/rollback',
      });
      throw new Error('cancel service operation');
    }),
  );
  assert.equal(repositories.companies.findByName('Rollback Incorporated'), undefined);
  database.close();
});
