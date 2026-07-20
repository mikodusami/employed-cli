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

  const updated = repositories.applications.updateStatus(created.id, 'interview');
  assert.equal(updated.status, 'interview');
  assert.equal(updated.first_response_at, null, 'updateStatus alone touches nothing else');
  assert.equal(updated.last_activity_at, null);
  database.close();
});

test('applications: touchActivity and setFirstResponse are separate, explicit writes', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const created = repositories.applications.create(
    { company_name: 'Acme' },
    '2026-01-01T00:00:00.000Z',
  );

  const touched = repositories.applications.touchActivity(created.id, '2026-01-02T00:00:00.000Z');
  assert.equal(touched.last_activity_at, '2026-01-02T00:00:00.000Z');
  assert.equal(touched.first_response_at, null);

  const responded = repositories.applications.setFirstResponse(
    created.id,
    '2026-01-03T00:00:00.000Z',
  );
  assert.equal(responded.first_response_at, '2026-01-03T00:00:00.000Z');

  const respondedAgain = repositories.applications.setFirstResponse(
    created.id,
    '2026-01-04T00:00:00.000Z',
  );
  assert.equal(respondedAgain.first_response_at, '2026-01-03T00:00:00.000Z', 'set only once');
  database.close();
});

test('applications: resume version, notes, list, and listByStatus', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const acme = repositories.applications.create(
    { company_name: 'Acme', status: 'applied' },
    '2026-01-01T00:00:00.000Z',
  );
  const globex = repositories.applications.create(
    { company_name: 'Globex', status: 'interview' },
    '2026-01-02T00:00:00.000Z',
  );

  const withResume = repositories.applications.updateResumeVersion(acme.id, 'backend-v2');
  assert.equal(withResume.resume_version, 'backend-v2');
  const withNotes = repositories.applications.updateNotes(acme.id, 'Referred by a friend.');
  assert.equal(withNotes.notes, 'Referred by a friend.');

  assert.equal(repositories.applications.list().length, 2);
  assert.deepEqual(
    repositories.applications.listByStatus('interview').map((application) => application.id),
    [globex.id],
  );
  assert.deepEqual(repositories.applications.list({ status: 'applied' }).map((a) => a.id), [
    acme.id,
  ]);
  database.close();
});

test('applications: findById and findByJobId', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const application = repositories.applications.create(
    { company_name: 'Acme', job_id: null },
    '2026-01-01T00:00:00.000Z',
  );
  assert.equal(repositories.applications.findById(application.id)?.company_name, 'Acme');
  assert.equal(repositories.applications.findById(999_999), undefined);
  assert.equal(repositories.applications.findByJobId(1), undefined);
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

test('events: listForApplication returns oldest to newest', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const application = repositories.applications.create(
    { company_name: 'Acme' },
    '2026-01-01T00:00:00.000Z',
  );
  repositories.events.append({
    application_id: application.id,
    at: '2026-01-02T00:00:00.000Z',
    type: 'interview',
  });
  repositories.events.append({
    application_id: application.id,
    at: '2026-01-01T00:00:00.000Z',
    type: 'applied',
  });

  const timeline = repositories.events.listForApplication(application.id);
  assert.deepEqual(
    timeline.map((event) => event.type),
    ['applied', 'interview'],
  );
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
