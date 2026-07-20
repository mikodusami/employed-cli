/** Verifies EMAIL_CLASSIFY's caching, batching, and zero-call empty-batch short circuit. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DefaultAiRunner } from '../src/ai/runner.js';
import type { AiProvider, AiRequest, ProviderStatus } from '../src/ai/types.js';
import { AppConfigSchema } from '../src/config/schema.js';
import { createDb, Repositories } from '../src/db/index.js';
import { AiTailClassifier } from '../src/gmail/ai-classify.js';
import type { EmailMeta } from '../src/gmail/types.js';

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

const email: EmailMeta = {
  threadId: 't1',
  date: '2026-01-01T00:00:00.000Z',
  sender: 'unknown@example.com',
  subject: 'Re: your role',
  snippet: 'Ambiguous content that no rule can place.',
};

const CLASSIFICATION_JSON = JSON.stringify([
  { id: 't1', type: 'interview', company: 'Acme', role: 'Engineer' },
]);

test('an empty low-confidence batch makes zero AI calls', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const provider = new RecordingProvider([]);
  const runner = new DefaultAiRunner([provider], repositories, AppConfigSchema.parse({}).ai);
  const classifier = new AiTailClassifier(runner);

  const result = await classifier.classify([]);

  assert.deepEqual(result, []);
  assert.equal(provider.calls, 0);
  database.close();
});

test('classifying the same batch twice is a single cached AI call', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const provider = new RecordingProvider([CLASSIFICATION_JSON]);
  const runner = new DefaultAiRunner([provider], repositories, AppConfigSchema.parse({}).ai);
  const classifier = new AiTailClassifier(runner);

  const first = await classifier.classify([email]);
  const second = await classifier.classify([email]);

  assert.deepEqual(first, [{ id: 't1', type: 'interview', company: 'Acme', role: 'Engineer' }]);
  assert.deepEqual(second, first);
  assert.equal(provider.calls, 1);
  database.close();
});
