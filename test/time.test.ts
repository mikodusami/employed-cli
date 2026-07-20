/** Verifies reusable compact relative-time labels. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { relativeTime } from '../src/util/time.js';

test('relativeTime formats past, future, recent, and invalid values', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  assert.equal(relativeTime('2026-07-17T12:00:00Z', now), '2d ago');
  assert.equal(relativeTime('2026-07-19T10:00:00Z', now), '2h ago');
  assert.equal(relativeTime('2026-07-19T12:20:00Z', now), 'in 20m');
  assert.equal(relativeTime('2026-07-19T11:59:45Z', now), 'just now');
  assert.equal(relativeTime('invalid', now), 'unknown');
});
