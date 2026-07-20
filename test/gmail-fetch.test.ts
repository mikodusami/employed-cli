/** Verifies EMAIL_FETCH's query, allowed tools, and cache-bypass behavior end to end. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DefaultAiRunner } from '../src/ai/runner.js';
import type { AiProvider, AiRequest, ProviderStatus } from '../src/ai/types.js';
import { AppConfigSchema } from '../src/config/schema.js';
import { createDb, Repositories } from '../src/db/index.js';
import { buildGmailQuery, EmailFetcher } from '../src/gmail/fetch.js';

class RecordingProvider implements AiProvider {
  public readonly name = 'codex' as const;
  public calls = 0;
  public readonly requests: AiRequest[] = [];

  public constructor(private readonly responses: string[]) {}

  public async isAvailable(): Promise<ProviderStatus> {
    return { available: true, version: '1.0.0', detail: null };
  }

  public async run(request: AiRequest): Promise<string> {
    this.calls += 1;
    this.requests.push(request);
    const response = this.responses[this.calls - 1];
    if (response === undefined) {
      throw new Error('No response configured.');
    }
    return response;
  }
}

const FIXTURE_EMAIL = JSON.stringify([
  {
    threadId: 't1',
    date: '2026-01-01T00:00:00.000Z',
    sender: 'no-reply@greenhouse.io',
    subject: 'Your application to Acme',
    snippet: 'We received your application.',
  },
]);

test('EmailFetcher requests the Gmail search tool and returns validated EmailMeta[]', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const provider = new RecordingProvider([FIXTURE_EMAIL]);
  const runner = new DefaultAiRunner([provider], repositories, AppConfigSchema.parse({}).ai);
  const fetcher = new EmailFetcher(runner);

  const emails = await fetcher.fetch(30);

  assert.deepEqual(emails, JSON.parse(FIXTURE_EMAIL));
  assert.deepEqual(provider.requests[0]?.allowedTools, ['mcp__gmail__search_threads']);
  assert.match(provider.requests[0]?.prompt ?? '', /newer_than:30d/);
  database.close();
});

test('EmailFetcher bypasses the cache: two fetches make two AI calls', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const provider = new RecordingProvider([FIXTURE_EMAIL, FIXTURE_EMAIL]);
  const runner = new DefaultAiRunner([provider], repositories, AppConfigSchema.parse({}).ai);
  const fetcher = new EmailFetcher(runner);

  await fetcher.fetch(30);
  await fetcher.fetch(30);

  assert.equal(provider.calls, 2);
  database.close();
});

test('buildGmailQuery includes the day window and known ATS sender domains', () => {
  const query = buildGmailQuery(7);
  assert.match(query, /newer_than:7d/);
  assert.match(query, /greenhouse\.io/);
  assert.match(query, /myworkday\.com/);
});
