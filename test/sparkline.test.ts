/** Verifies block-character scaling, the all-zero flat line, and single-spike rendering. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { sparkline } from '../src/util/sparkline.js';

test('scales 12 buckets to block characters relative to the max bucket', () => {
  const counts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10];
  const chart = sparkline(counts);
  assert.equal(chart.length, 12);
  assert.equal(chart[0], '▁');
  assert.equal(chart.at(-1), '█');
  assert.equal(chart.at(-2), '█');
});

test('an all-zero series renders as a flat line at the lowest block', () => {
  const chart = sparkline(new Array(12).fill(0));
  assert.equal(chart, '▁'.repeat(12));
});

test('a single spike renders that bucket at the tallest block and the rest flat', () => {
  const counts = [0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  const chart = sparkline(counts);
  assert.equal(chart[3], '█');
  assert.equal(chart[0], '▁');
  assert.equal(chart[7], '▁');
});

test('an empty series renders as an empty string', () => {
  assert.equal(sparkline([]), '');
});
