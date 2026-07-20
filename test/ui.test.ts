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
