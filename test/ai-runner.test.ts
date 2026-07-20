/** Verifies provider fallback, scoped caching, correction retry, budgets, and degradation. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import {
  AiBudgetExceededError,
  AiUnavailableError,
  AiValidationError,
  buildAiProviders,
  buildAiRunner,
} from '../src/ai/index.js';
import { DefaultAiRunner } from '../src/ai/runner.js';
import type {
  AiProvider,
  AiRequest,
  ProviderStatus,
} from '../src/ai/types.js';
import { AppConfigSchema, type ProviderName } from '../src/config/schema.js';
import { createDb, Repositories } from '../src/db/index.js';

const ResultSchema = z.object({ ok: z.boolean() });

class FakeProvider implements AiProvider {
  public calls = 0;
  public readonly prompts: string[] = [];

  public constructor(
    public readonly name: ProviderName,
    private readonly status: ProviderStatus,
    private readonly outputs: Array<string | Error> = [],
  ) {}

  public async isAvailable(): Promise<ProviderStatus> {
    return this.status;
  }

  public async run(request: AiRequest): Promise<string> {
    this.calls += 1;
    this.prompts.push(request.prompt);
    const output = this.outputs.shift();
    if (output instanceof Error) {
      throw output;
    }
    if (output === undefined) {
      throw new Error(`No output configured for ${this.name}.`);
    }
    return output;
  }
}

test('runner follows preference fallback and reports total unavailability', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const codex = provider('codex', false);
  const claude = provider('claude', true, ['{"ok":true}']);
  const runner = new DefaultAiRunner([codex, claude], repositories, config().ai);

  assert.deepEqual(await runner.runJson(task('fallback')), { ok: true });
  assert.equal(codex.calls, 0);
  assert.equal(claude.calls, 1);

  const unavailable = new DefaultAiRunner(
    [provider('codex', false), provider('claude', false)],
    repositories,
    config().ai,
  );
  await assert.rejects(() => unavailable.runJson(task('none')), AiUnavailableError);
  database.close();
});

test('provider-scoped cache is free and never crosses providers', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const codex = provider('codex', true, ['{"ok":true}']);
  const firstRunner = new DefaultAiRunner([codex], repositories, config().ai);

  assert.deepEqual(await firstRunner.runJson(task('same')), { ok: true });
  assert.deepEqual(await firstRunner.runJson(task('same')), { ok: true });
  assert.equal(codex.calls, 1);

  const claude = provider('claude', true, ['{"ok":true}']);
  const secondRunner = new DefaultAiRunner([claude], repositories, config().ai);
  assert.deepEqual(await secondRunner.runJson(task('same')), { ok: true });
  assert.equal(claude.calls, 1);
  database.close();
});

test('runner corrects invalid JSON exactly once', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const providerWithCorrection = provider('codex', true, [
    '{"ok":"wrong"}',
    '```json\n{"ok":true}\n```',
  ]);
  const runner = new DefaultAiRunner([providerWithCorrection], repositories, config().ai);

  assert.deepEqual(await runner.runJson(task('corrected')), { ok: true });
  assert.equal(providerWithCorrection.calls, 2);
  assert.match(providerWithCorrection.prompts[1] ?? '', /previous response failed validation/);

  const alwaysInvalid = provider('claude', true, ['not json', '{"ok":1}']);
  const invalidRunner = new DefaultAiRunner([alwaysInvalid], repositories, config().ai);
  await assert.rejects(
    () => invalidRunner.runJson(task('invalid-twice')),
    (error: unknown) =>
      error instanceof AiValidationError &&
      error.responses[0] === 'not json' &&
      error.responses[1] === '{"ok":1}',
  );
  database.close();
});

test('budget counts provider calls while cache hits remain free', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const fake = provider('codex', true, ['{"ok":true}', '{"ok":true}']);
  const runner = new DefaultAiRunner([fake], repositories, config(2).ai);

  await runner.runJson(task('one'));
  await runner.runJson(task('one'));
  await runner.runJson(task('two'));
  await assert.rejects(() => runner.runJson(task('three')), AiBudgetExceededError);
  assert.equal(fake.calls, 2);
  database.close();
});

test('disabled providers are filtered and master disable returns null', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const partial = config(10, {
    preference: ['claude', 'codex'],
    providers: { claude: { enabled: false }, codex: { enabled: true } },
  });
  assert.deepEqual(buildAiProviders(partial.ai).map(({ name }) => name), ['codex']);

  const disabled = config(10, { enabled: false });
  assert.equal(buildAiRunner({ repos: repositories, config: disabled }), null);
  database.close();
});

function task(inputDigest: string) {
  return {
    templateId: 'test_v1',
    input: 'Return JSON.',
    inputDigest,
    schema: ResultSchema,
    timeoutMs: 100,
  };
}

function provider(
  name: ProviderName,
  available: boolean,
  outputs: Array<string | Error> = [],
): FakeProvider {
  return new FakeProvider(
    name,
    { available, version: available ? '1.0.0' : null, detail: available ? null : 'missing' },
    outputs,
  );
}

function config(
  maxCallsPerRun = 10,
  ai: Record<string, unknown> = {},
) {
  return AppConfigSchema.parse({ ai: { maxCallsPerRun, ...ai } });
}
