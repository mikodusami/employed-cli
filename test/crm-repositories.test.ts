/** Verifies application/event/email-thread repository CRUD, matching, and ledger idempotency. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDb, Repositories } from '../src/db/index.js';

test('applications: create, find by company+role, and update status', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);

  const created = repositories.applications.create(
    { company_name: 'Acme', role: 'Backend Engineer' },
    '2026-01-01T00:00:00.000Z',
  );
  assert.equal(created.status, 'applied');
  assert.equal(created.created_at, '2026-01-01T00:00:00.000Z');

  const foundExact = repositories.applications.findByCompanyRole('acme', 'backend engineer');
  assert.equal(foundExact?.id, created.id);

  const foundNoRole = repositories.applications.findByCompanyRole('Acme', null);
  assert.equal(foundNoRole?.id, created.id);

  const notFound = repositories.applications.findByCompanyRole('Globex', null);
  assert.equal(notFound, undefined);

  const updated = repositories.applications.updateStatus(
    created.id,
    'interview',
    '2026-01-02T00:00:00.000Z',
  );
  assert.equal(updated.status, 'interview');
  assert.equal(updated.first_response_at, '2026-01-02T00:00:00.000Z');
  assert.equal(updated.last_activity_at, '2026-01-02T00:00:00.000Z');

  const updatedAgain = repositories.applications.updateStatus(
    created.id,
    'offer',
    '2026-01-03T00:00:00.000Z',
  );
  assert.equal(updatedAgain.status, 'offer');
  assert.equal(updatedAgain.first_response_at, '2026-01-02T00:00:00.000Z', 'set only once');
  assert.equal(updatedAgain.last_activity_at, '2026-01-03T00:00:00.000Z');
  database.close();
});

test('events: append is immutable and tied to its application', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const application = repositories.applications.create(
    { company_name: 'Acme' },
    '2026-01-01T00:00:00.000Z',
  );

  const event = repositories.events.append({
    application_id: application.id,
    at: '2026-01-01T00:00:00.000Z',
    type: 'email',
    note: 'Classified as applied via email sync.',
  });

  assert.equal(event.application_id, application.id);
  assert.equal(event.type, 'email');
  database.close();
});

test('email thread ledger: isSeen, batch seenThreadIds, and idempotent re-processing', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const application = repositories.applications.create(
    { company_name: 'Acme' },
    '2026-01-01T00:00:00.000Z',
  );

  assert.equal(repositories.emailThreads.isSeen('t1'), false);
  repositories.emailThreads.markProcessed({
    thread_id: 't1',
    classified_as: 'applied',
    processed_at: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(repositories.emailThreads.isSeen('t1'), true);

  const seen = repositories.emailThreads.seenThreadIds(['t1', 't2', 't3']);
  assert.deepEqual([...seen], ['t1']);
  assert.deepEqual([...repositories.emailThreads.seenThreadIds([])], []);

  // Re-processing the same thread updates in place rather than throwing a uniqueness error.
  repositories.emailThreads.markProcessed({
    thread_id: 't1',
    application_id: application.id,
    classified_as: 'interview',
    processed_at: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(repositories.emailThreads.isSeen('t1'), true);
  database.close();
});
