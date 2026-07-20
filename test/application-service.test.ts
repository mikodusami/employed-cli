/** Verifies the single transition chokepoint: creation, transitions, notes, list, and detail. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDb, Repositories } from '../src/db/index.js';
import { ApplicationService } from '../src/services/application.js';
import { ValidationError } from '../src/util/errors.js';

const FIXED_CLOCK = () => new Date('2026-01-10T00:00:00.000Z');

test('createFromJob links the application to its job and appends an applied event', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = repositories.companies.insert({
    name: 'Acme',
    careers_url: 'https://example.com/careers',
  });
  const job = repositories.jobs.upsert({
    company_id: company.id,
    title: 'Backend Engineer',
    url: 'https://example.com/jobs/1',
    first_seen: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    dedupe_key: 'job-1',
  }).job;
  const service = new ApplicationService(repositories, FIXED_CLOCK);

  const result = await service.createFromJob(job.id, { resumeVersion: 'backend-v2' });

  assert.equal(result.created, true);
  assert.equal(result.application.company_name, 'Acme');
  assert.equal(result.application.role, 'Backend Engineer');
  assert.equal(result.application.job_id, job.id);
  assert.equal(result.application.resume_version, 'backend-v2');
  assert.equal(result.application.status, 'applied');

  const events = repositories.events.listForApplication(result.application.id);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'applied');
  database.close();
});

test('createFromJob is idempotent: re-running returns the existing application', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = repositories.companies.insert({
    name: 'Acme',
    careers_url: 'https://example.com/careers',
  });
  const job = repositories.jobs.upsert({
    company_id: company.id,
    title: 'Backend Engineer',
    url: 'https://example.com/jobs/1',
    first_seen: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    dedupe_key: 'job-1',
  }).job;
  const service = new ApplicationService(repositories, FIXED_CLOCK);

  const first = await service.createFromJob(job.id);
  const second = await service.createFromJob(job.id);

  assert.equal(second.created, false);
  assert.equal(second.application.id, first.application.id);
  assert.equal(repositories.applications.list().length, 1);
  assert.equal(repositories.events.listForApplication(first.application.id).length, 1);
  database.close();
});

test('createFromJob rejects an unknown job id', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const service = new ApplicationService(repositories, FIXED_CLOCK);
  await assert.rejects(() => service.createFromJob(999_999), ValidationError);
  database.close();
});

test('createManual produces a job-id-null application indistinguishable in listings', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const service = new ApplicationService(repositories, FIXED_CLOCK);

  const application = await service.createManual({ company: 'Globex', role: 'PM' });

  assert.equal(application.job_id, null);
  assert.equal(application.status, 'applied');
  const [listed] = service.list();
  assert.equal(listed?.id, application.id);
  database.close();
});

test('transition appends an event, updates status, and sets first_response_at once', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const service = new ApplicationService(repositories, FIXED_CLOCK);
  const application = await service.createManual({ company: 'Acme' });

  const toInterview = await service.transition(application.id, 'interview');
  assert.equal(toInterview.warning, null, 'applied -> interview is an expected transition');
  assert.equal(toInterview.application.status, 'interview');
  assert.equal(toInterview.application.first_response_at, '2026-01-10T00:00:00.000Z');
  assert.equal(toInterview.application.last_activity_at, '2026-01-10T00:00:00.000Z');

  const toOffer = await service.transition(application.id, 'offer', { note: 'Got an offer!' });
  assert.equal(toOffer.warning, null);
  assert.equal(
    toOffer.application.first_response_at,
    '2026-01-10T00:00:00.000Z',
    'first_response_at is set only once',
  );

  const events = repositories.events.listForApplication(application.id);
  assert.deepEqual(
    events.map((event) => event.type),
    ['applied', 'interview', 'offer'],
  );
  assert.equal(events[2]?.note, 'Got an offer!');
  database.close();
});

test('an unusual transition warns but still succeeds', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const service = new ApplicationService(repositories, FIXED_CLOCK);
  const application = await service.createManual({ company: 'Acme', status: 'rejected' });

  const result = await service.transition(application.id, 'oa');

  assert.match(result.warning ?? '', /Unusual transition: rejected → oa/);
  assert.equal(result.application.status, 'oa', 'unusual transitions are recorded, not blocked');
  database.close();
});

test('transition rejects an unknown application id', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const service = new ApplicationService(repositories, FIXED_CLOCK);
  await assert.rejects(() => service.transition(999_999, 'offer'), ValidationError);
  database.close();
});

test('addNote appends a note event and bumps activity without changing status', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const service = new ApplicationService(repositories, FIXED_CLOCK);
  const application = await service.createManual({ company: 'Acme' });

  await service.addNote(application.id, 'Recruiter called to check in.');

  const events = repositories.events.listForApplication(application.id);
  assert.equal(events[1]?.type, 'note');
  assert.equal(events[1]?.note, 'Recruiter called to check in.');
  const refreshed = repositories.applications.findById(application.id);
  assert.equal(refreshed?.status, 'applied', 'a note never changes status');
  assert.equal(refreshed?.last_activity_at, '2026-01-10T00:00:00.000Z');
  database.close();
});

test('detail returns the application plus its full chronological event timeline', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const service = new ApplicationService(repositories, FIXED_CLOCK);
  const application = await service.createManual({ company: 'Acme' });
  await service.transition(application.id, 'interview');
  await service.addNote(application.id, 'Prepping for the call.');

  const detail = service.detail(application.id);

  assert.equal(detail.application.id, application.id);
  assert.deepEqual(
    detail.events.map((event) => event.type),
    ['applied', 'interview', 'note'],
  );
  database.close();
});

test('list filters by status', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const service = new ApplicationService(repositories, FIXED_CLOCK);
  await service.createManual({ company: 'Acme' });
  const globex = await service.createManual({ company: 'Globex', status: 'interview' });

  const interviewing = service.list({ status: 'interview' });
  assert.deepEqual(
    interviewing.map((application) => application.id),
    [globex.id],
  );
  database.close();
});
