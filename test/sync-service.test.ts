/** Verifies the six-stage sync pipeline: fetch, seen-filter, rule/AI classify, resolve, apply. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AiClassificationResult } from '../src/gmail/ai-classify.js';
import type { EmailMeta } from '../src/gmail/types.js';
import { createDb, Repositories } from '../src/db/index.js';
import { ApplicationService } from '../src/services/application.js';
import type {
  EmailFetcherLike,
  AiTailClassifierLike,
  ProposalPrompter,
  SyncProposal,
} from '../src/services/sync.js';
import { SyncService } from '../src/services/sync.js';
import type { AiRunner, AiTask } from '../src/ai/types.js';

const FIXED_CLOCK = () => new Date('2026-01-10T00:00:00.000Z');

class FakeFetcher implements EmailFetcherLike {
  public calls = 0;

  public constructor(private readonly emails: readonly EmailMeta[]) {}

  public async fetch(): Promise<EmailMeta[]> {
    this.calls += 1;
    return [...this.emails];
  }
}

class FakeTailClassifier implements AiTailClassifierLike {
  public calls = 0;
  public lastBatch: readonly EmailMeta[] = [];

  public constructor(private readonly results: readonly AiClassificationResult[]) {}

  public async classify(
    lowConfidence: readonly EmailMeta[],
  ): Promise<readonly AiClassificationResult[]> {
    this.calls += 1;
    this.lastBatch = lowConfidence;
    if (lowConfidence.length === 0) {
      return [];
    }
    return this.results;
  }
}

class AcceptAllPrompter implements ProposalPrompter {
  public async selectProposals(proposals: readonly SyncProposal[]): Promise<readonly string[]> {
    return proposals.map((proposal) => proposal.threadId);
  }
}

class ScriptedPrompter implements ProposalPrompter {
  public constructor(private readonly acceptedThreadIds: readonly string[]) {}

  public async selectProposals(): Promise<readonly string[]> {
    return this.acceptedThreadIds;
  }
}

/** A never-called stand-in `AiRunner` — only used to prove the AI-null gate short-circuits. */
const UNUSED_AI: AiRunner = {
  runJson: <Result>(_task: AiTask<Result>): Promise<Result> => {
    throw new Error('AiRunner should never be called.');
  },
};

const highConfidenceApplied: EmailMeta = {
  threadId: 'applied-1',
  date: '2026-01-01T00:00:00.000Z',
  sender: 'no-reply@greenhouse.io',
  subject: 'Your application to Acme',
  snippet: 'We have received your application and will be in touch.',
};

const highConfidenceRejection: EmailMeta = {
  threadId: 'rejected-1',
  date: '2026-01-02T00:00:00.000Z',
  sender: 'recruiting@acme.example.com',
  subject: 'Update on your application to Acme',
  snippet: 'After careful consideration, we have decided to move forward with other candidates.',
};

const ignoreDigest: EmailMeta = {
  threadId: 'ignore-1',
  date: '2026-01-03T00:00:00.000Z',
  sender: 'jobalerts-noreply@linkedin.com',
  subject: '5 new jobs matching your search',
  snippet: 'New jobs recommended for you.',
};

const lowConfidenceEmail: EmailMeta = {
  threadId: 'low-1',
  date: '2026-01-04T00:00:00.000Z',
  sender: 'unknown@example.com',
  subject: 'Re: your role',
  snippet: 'Ambiguous content no rule can place.',
};

const unresolvedNoCompany: EmailMeta = {
  threadId: 'unresolved-1',
  date: '2026-01-05T00:00:00.000Z',
  sender: 'no-reply@ashbyhq.com',
  subject: 'Thank you for applying!',
  snippet: 'Thank you for applying. We received it.',
};

test('rules classify the confident majority; only low-confidence goes to the AI tail', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const fetcher = new FakeFetcher([
    highConfidenceApplied,
    ignoreDigest,
    lowConfidenceEmail,
    unresolvedNoCompany,
  ]);
  const tailClassifier = new FakeTailClassifier([
    { id: 'low-1', type: 'interview', company: 'Beta Corp', role: 'Engineer' },
  ]);
  const service = new SyncService(
    repositories,
    new ApplicationService(repositories, FIXED_CLOCK),
    fetcher,
    tailClassifier,
    UNUSED_AI,
    new AcceptAllPrompter(),
    FIXED_CLOCK,
  );

  const result = await service.run('interactive', { days: 30 });

  assert.equal(result.fetched, 4);
  assert.equal(result.newlyProcessed, 4);
  assert.equal(result.ignored, 1);
  assert.equal(result.unresolved, 1);
  assert.equal(result.applied, 2); // highConfidenceApplied (Acme) + lowConfidenceEmail (Beta Corp)
  assert.deepEqual(
    tailClassifier.lastBatch.map((email) => email.threadId),
    ['low-1'],
    'only the low-confidence email is sent to the AI tail',
  );

  const acme = repositories.applications.findByCompanyRole('Acme', null);
  assert.equal(acme?.status, 'applied');
  const beta = repositories.applications.findByCompanyRole('Beta Corp', 'Engineer');
  assert.equal(beta?.status, 'interview');
  database.close();
});

test('ledger idempotency: a second sync over the same inbox processes 0 new threads', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const emails = [highConfidenceApplied, ignoreDigest];
  const fetcher = new FakeFetcher(emails);
  const service = new SyncService(
    repositories,
    new ApplicationService(repositories, FIXED_CLOCK),
    fetcher,
    new FakeTailClassifier([]),
    UNUSED_AI,
    new AcceptAllPrompter(),
    FIXED_CLOCK,
  );

  const first = await service.run('interactive', { days: 30 });
  const second = await service.run('interactive', { days: 30 });

  assert.equal(first.newlyProcessed, 2);
  assert.equal(second.fetched, 2);
  assert.equal(second.newlyProcessed, 0);
  assert.equal(second.applied, 0);
  assert.equal(second.ignored, 0);
  assert.equal(fetcher.calls, 2, 'fetch still runs each sync; only the seen-filter changes');
  database.close();
});

test('cron: high-confidence exact-match auto-applies; low-confidence defers', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  repositories.applications.create(
    { company_name: 'Acme', status: 'applied' },
    '2025-12-01T00:00:00.000Z',
  );
  const fetcher = new FakeFetcher([highConfidenceRejection, lowConfidenceEmail]);
  const tailClassifier = new FakeTailClassifier([
    { id: 'low-1', type: 'rejected', company: 'Acme', role: null },
  ]);
  const service = new SyncService(
    repositories,
    new ApplicationService(repositories, FIXED_CLOCK),
    fetcher,
    tailClassifier,
    UNUSED_AI,
    new AcceptAllPrompter(), // never invoked in cron mode
    FIXED_CLOCK,
  );

  const result = await service.run('cron', { days: 30 });

  assert.equal(result.applied, 1);
  assert.equal(result.deferred, 1);
  assert.deepEqual(result.autoApplied, [
    { company: 'Acme', role: 'Unknown role', status: 'rejected' },
  ]);

  const acme = repositories.applications.findByCompanyRole('Acme', null);
  assert.equal(acme?.status, 'rejected');

  const appliedThread = repositories.emailThreads.find('rejected-1');
  assert.equal(appliedThread?.application_id, acme?.id);
  assert.equal(appliedThread?.classified_as, 'rejected');

  const deferredThread = repositories.emailThreads.find('low-1');
  assert.ok(deferredThread, 'deferred threads are still ledgered so cron never reprocesses them');
  assert.equal(deferredThread?.application_id, null);
  database.close();
});

test('interactive: accepting writes the CRM change; rejecting still ledgers it', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const fetcher = new FakeFetcher([highConfidenceApplied, highConfidenceRejection]);
  repositories.applications.create(
    { company_name: 'Acme', status: 'applied' },
    '2025-12-01T00:00:00.000Z',
  );
  // Only accept the rejection update; leave the (redundant) applied-confirmation proposal rejected.
  const service = new SyncService(
    repositories,
    new ApplicationService(repositories, FIXED_CLOCK),
    fetcher,
    new FakeTailClassifier([]),
    UNUSED_AI,
    new ScriptedPrompter(['rejected-1']),
    FIXED_CLOCK,
  );

  const result = await service.run('interactive', { days: 30 });

  assert.equal(result.applied, 1);
  assert.equal(result.deferred, 1);

  const acme = repositories.applications.findByCompanyRole('Acme', null);
  assert.equal(acme?.status, 'rejected');

  const acceptedThread = repositories.emailThreads.find('rejected-1');
  assert.equal(acceptedThread?.application_id, acme?.id);

  const rejectedThread = repositories.emailThreads.find('applied-1');
  assert.ok(rejectedThread, 'a rejected proposal is still ledgered so it does not recur');
  assert.equal(rejectedThread?.application_id, null);
  database.close();
});

test('every CRM write from sync appends a corresponding events row', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const fetcher = new FakeFetcher([highConfidenceApplied]);
  const service = new SyncService(
    repositories,
    new ApplicationService(repositories, FIXED_CLOCK),
    fetcher,
    new FakeTailClassifier([]),
    UNUSED_AI,
    new AcceptAllPrompter(),
    FIXED_CLOCK,
  );

  await service.run('interactive', { days: 30 });

  const acme = repositories.applications.findByCompanyRole('Acme', null);
  assert.ok(acme);
  const event = database
    .prepare('SELECT * FROM events WHERE application_id = ?')
    .get(acme.id) as { type: string; note: string } | undefined;
  // A sync-driven event carries the same type as the status it produced (here 'applied'), not a
  // generic 'email' tag — this is what lets a later `stats` feature event-scan without caring
  // whether a status change came from sync or a manual `move`. Provenance lives in the note.
  assert.equal(event?.type, 'applied');
  assert.match(event?.note ?? '', /applied-1/);
  database.close();
});

test('ai === null: sync no-ops cleanly, nothing written, exit successful', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const fetcher: EmailFetcherLike = {
    fetch: () => {
      throw new Error('fetch should never be called when ai is null');
    },
  };
  const tailClassifier: AiTailClassifierLike = {
    classify: () => {
      throw new Error('classify should never be called when ai is null');
    },
  };
  const service = new SyncService(
    repositories,
    new ApplicationService(repositories, FIXED_CLOCK),
    fetcher,
    tailClassifier,
    null,
    new AcceptAllPrompter(),
  );

  const cronResult = await service.run('cron', { days: 30 });
  const interactiveResult = await service.run('interactive', { days: 30 });

  assert.equal(cronResult.skipped, true);
  assert.equal(interactiveResult.skipped, true);
  assert.equal(repositories.applications.findByCompanyRole('Acme', null), undefined);
  database.close();
});

test('a sync-driven rejection matches a manual move-to-rejected event shape', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const applicationService = new ApplicationService(repositories, FIXED_CLOCK);

  // Manual path: create, then `move ... rejected` via the same chokepoint the CLI uses.
  const manualApp = await applicationService.createManual({ company: 'Manual Co' });
  await applicationService.transition(manualApp.id, 'rejected');
  const manualEvent = repositories.events
    .listForApplication(manualApp.id)
    .find((event) => event.type === 'rejected');

  // Sync path: an existing application, rejected via a high-confidence cron proposal.
  repositories.applications.create(
    { company_name: 'Sync Co', status: 'applied' },
    FIXED_CLOCK().toISOString(),
  );
  const fetcher = new FakeFetcher([
    {
      threadId: 'sync-rejected-1',
      date: '2026-01-02T00:00:00.000Z',
      sender: 'recruiting@synco.example.com',
      subject: 'Update on your application to Sync Co',
      snippet: 'We have decided to move forward with other candidates.',
    },
  ]);
  const service = new SyncService(
    repositories,
    applicationService,
    fetcher,
    new FakeTailClassifier([]),
    UNUSED_AI,
    new AcceptAllPrompter(),
    FIXED_CLOCK,
  );
  await service.run('cron', { days: 30 });
  const syncApp = repositories.applications.findByCompanyRole('Sync Co', null);
  assert.ok(syncApp);
  const syncEvent = repositories.events
    .listForApplication(syncApp.id)
    .find((event) => event.type === 'rejected');

  assert.ok(manualEvent);
  assert.ok(syncEvent);
  assert.equal(syncEvent.type, manualEvent.type);
  assert.equal(syncEvent.application_id, syncApp.id);
  // Both changed status to rejected identically; only the note differentiates provenance.
  assert.equal(repositories.applications.findById(syncApp.id)?.status, 'rejected');
  assert.equal(repositories.applications.findById(manualApp.id)?.status, 'rejected');
  database.close();
});
