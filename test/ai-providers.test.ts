/** Verifies provider argv safety, envelopes, availability caching, and timeout mapping. */
import assert from 'node:assert/strict';
import type { ChildProcessByStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, type Readable } from 'node:stream';
import test from 'node:test';

import { AiProviderError, ProviderUnavailableError } from '../src/ai/index.js';
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from '../src/ai/process.js';
import { NodeProcessRunner } from '../src/ai/process.js';
import { ClaudeCodeProvider } from '../src/ai/providers/claude.js';
import {
  CodexProvider,
  extractFinalAgentMessage,
} from '../src/ai/providers/codex.js';

class FakeProcesses implements ProcessRunner {
  public readonly requests: ProcessRequest[] = [];

  public constructor(private readonly outcomes: Array<ProcessResult | Error>) {}

  public async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    const outcome = this.outcomes.shift();
    if (outcome instanceof Error) {
      throw outcome;
    }
    if (!outcome) {
      throw new Error('No fake process outcome configured.');
    }
    return outcome;
  }
}

test('Claude provider caches availability and parses the result envelope', async () => {
  const processes = new FakeProcesses([
    result('1.2.3'),
    result('{"result":"{\\"ok\\":true}"}'),
  ]);
  const provider = new ClaudeCodeProvider(processes);

  assert.equal((await provider.isAvailable()).version, '1.2.3');
  assert.equal((await provider.isAvailable()).available, true);
  assert.equal(
    await provider.run({ prompt: 'Return JSON', timeoutMs: 1000, allowedTools: ['gmail'] }),
    '{"ok":true}',
  );
  assert.deepEqual(processes.requests[1]?.args, [
    '-p',
    'Return JSON',
    '--output-format',
    'json',
    '--allowedTools',
    'gmail',
  ]);
  assert.equal(processes.requests.length, 2);
});

test('Codex provider uses current safe exec flags and final agent message', async () => {
  const jsonLines = [
    '{"type":"thread.started","thread_id":"1"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}',
  ].join('\n');
  const processes = new FakeProcesses([result(jsonLines)]);
  const debug: string[] = [];
  const provider = new CodexProvider(processes, (message) => debug.push(message));

  assert.equal(
    await provider.run({ prompt: 'Return JSON', timeoutMs: 1000, allowedTools: ['gmail'] }),
    'final',
  );
  assert.deepEqual(processes.requests[0]?.args, [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    'Return JSON',
  ]);
  assert.match(debug[0] ?? '', /configured outside each call/);
  assert.equal(extractFinalAgentMessage(jsonLines), 'final');
});

test('providers map timeout and missing binaries to typed errors', async () => {
  const timedOut = new CodexProvider(
    new FakeProcesses([{ ...result(''), timedOut: true, exitCode: null }]),
  );
  await assert.rejects(
    () => timedOut.run({ prompt: 'hang', timeoutMs: 25 }),
    (error: unknown) => error instanceof AiProviderError && error.message.includes('timed out'),
  );

  const missingError = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
  const missing = new ClaudeCodeProvider(new FakeProcesses([missingError]));
  await assert.rejects(
    () => missing.run({ prompt: 'test', timeoutMs: 25 }),
    ProviderUnavailableError,
  );
});

test('process timeout escalates to a hard kill and waits for child exit', async () => {
  const signals: NodeJS.Signals[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: (signal: NodeJS.Signals): boolean => {
      signals.push(signal);
      if (signal === 'SIGKILL') {
        queueMicrotask(() => child.emit('close', null));
      }
      return true;
    },
  });
  const spawnFake = () =>
    child as unknown as ChildProcessByStdio<null, Readable, Readable>;
  const processes = new NodeProcessRunner(spawnFake, 1);

  const outcome = await processes.run({ binary: 'never-finishes', args: [], timeoutMs: 1 });

  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.exitCode, null);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

function result(stdout: string): ProcessResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}
