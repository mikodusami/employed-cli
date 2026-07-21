/** Verifies JSONL durability, scoping, rotation, levels, trace timing, and failure isolation. */
import assert from 'node:assert/strict';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ProgressHandle } from '../src/ui/index.js';
import { createLogger, stage, type LogEvent, type LogLevel } from '../src/util/log.js';

test('logger writes scoped JSONL, filters console, and rotates old logs', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'employed-log-'));
  const old = path.join(directory, 'old.log');
  writeFileSync(old, '{}\n');
  utimesSync(old, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T00:00:00Z'));
  const consoleEvents: Array<[LogLevel, string]> = [];
  const logger = createLogger({
    logsDirectory: directory,
    command: 'run',
    consoleLevel: 'info',
    retentionDays: 14,
    now: () => new Date('2026-07-21T12:34:56Z'),
    consoleSink: (level, message) => consoleEvents.push([level, message]),
  });

  logger.child('capture').debug('request', { url: 'https://example.com' });
  logger.child('scrape:Meta').info('finished', { count: 34 });

  assert.equal(logger.filePath?.endsWith('run-2026-07-21-123456.log'), true);
  assert.equal(existsSync(old), false);
  const events = readEvents(logger.filePath ?? '');
  assert.deepEqual(events.map(({ scope, level }) => [scope, level]), [
    ['capture', 'debug'],
    ['scrape:Meta', 'info'],
  ]);
  assert.deepEqual(consoleEvents, [['info', 'finished']]);
});

test('trace stages update progress and include elapsed time in JSONL', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'employed-trace-'));
  const lines: string[] = [];
  const handle: ProgressHandle = {
    step: (message) => lines.push(message),
    substep: () => undefined,
    succeed: () => undefined,
    fail: () => undefined,
  };
  const logger = createLogger({ logsDirectory: directory, command: 'scan', trace: true });

  stage(handle, logger.child('capture'), 'fetching careers page', { attempt: 1 });
  stage(handle, logger.child('plan'), 'asking AI', { attempt: 1 });

  assert.match(lines[0] ?? '', /\(\+0ms\)$/);
  assert.match(lines[1] ?? '', /\(\+\d+ms\)$/);
  assert.equal(
    readEvents(logger.filePath ?? '').every((event) => event.data?.elapsedMs !== undefined),
    true,
  );
});

test('an unwritable log target warns once and never throws', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'employed-log-failure-'));
  const occupied = path.join(directory, 'not-a-directory');
  const descriptor = openSync(occupied, 'w');
  closeSync(descriptor);
  const warnings: string[] = [];

  const logger = createLogger({
    logsDirectory: occupied,
    command: 'doctor',
    consoleSink: (level, message) => {
      if (level === 'warn') {
        warnings.push(message);
      }
    },
  });
  logger.info('still running');
  logger.error('also still running');

  assert.equal(logger.filePath, null);
  assert.equal(warnings.length, 1);
});

function readEvents(filePath: string): LogEvent[] {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEvent);
}
