/** Verifies every generated-extraction validation gate. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { RawPosting } from '../src/scrape/types.js';
import { validateExtraction } from '../src/scrape/validate.js';

const valid: RawPosting[] = [
  posting('Software Engineer', 'one'),
  posting('Product Engineer', 'two'),
  posting('Backend Developer', 'three'),
  posting('Frontend Developer', 'four'),
  posting('Associate Engineer', 'five'),
];

test('a varied extraction with absolute URLs and realistic titles passes', () => {
  assert.deepEqual(validateExtraction(valid), { ok: true });
});

test('empty extraction and empty required fields fail with direct reasons', () => {
  assert.match(reasons([]), /no postings/i);
  assert.match(reasons([{ title: '', url: '/relative' }]), /non-empty title/i);
  assert.match(reasons([{ title: 'Software Engineer', url: '/relative' }]), /absolute/i);
});

test('duplicate floods fail while a minority duplicate remains valid', () => {
  const flood = [
    posting('Software Engineer', '1'),
    posting('Software Engineer', '2'),
    posting('Software Engineer', '3'),
    posting('Product Engineer', '4'),
  ];
  assert.match(reasons(flood), /Duplicate titles/i);
  assert.deepEqual(
    validateExtraction([...valid, posting('Software Engineer', 'six')]),
    { ok: true },
  );
});

test('unrealistic median title lengths fail both bounds', () => {
  assert.match(reasons([posting('Tiny', '1')]), /Median title length/i);
  assert.match(reasons([posting('X'.repeat(81), '2')]), /Median title length/i);
});

test('navigation contamination fails at the twenty-percent boundary', () => {
  const contaminated = [...valid.slice(0, 4), posting('Careers', 'nav')];
  assert.match(reasons(contaminated), /Navigation labels/i);
  assert.deepEqual(
    validateExtraction([...valid, posting('Data Engineer', 'six')]),
    { ok: true },
  );
});

function posting(title: string, path: string): RawPosting {
  return { title, url: `https://example.com/jobs/${path}` };
}

function reasons(postings: RawPosting[]): string {
  const verdict = validateExtraction(postings);
  assert.equal(verdict.ok, false);
  return verdict.ok ? '' : verdict.reasons.join('\n');
}
