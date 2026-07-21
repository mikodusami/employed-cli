/** Verifies deterministic table output for redirected and automated runs. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createUI } from '../src/ui/index.js';

test('plain UI tables align columns without terminal control sequences', () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => lines.push(String(message));
  try {
    createUI(false).table(
      ['Name', 'Health'],
      [
        ['A', 'ok'],
        ['Long Company', 'untested'],
      ],
    );
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(lines, [
    'Name          Health  ',
    '------------  --------',
    'A             ok      ',
    'Long Company  untested',
  ]);
  assert.equal(lines.join('\n').includes('\u001B'), false);
});

test('plain progress prints every stage as timestamped sequential output', () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => lines.push(String(message));
  try {
    const progress = createUI(false).progress('Generating Fixture');
    progress.step('capturing page');
    progress.substep('capture complete');
    progress.succeed('2 jobs extracted');
  } finally {
    console.log = originalLog;
  }

  assert.equal(lines.length, 4);
  assert.match(lines[0] ?? '', /^\[\d{4}-\d{2}-\d{2}T.*Z\] Generating Fixture$/);
  assert.match(lines[1] ?? '', /Generating Fixture — capturing page$/);
  assert.match(lines[2] ?? '', /· capture complete$/);
  assert.match(lines[3] ?? '', /✓ 2 jobs extracted$/);
  assert.equal(lines.join('\n').includes('\u001B'), false);
});
