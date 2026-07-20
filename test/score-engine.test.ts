/** Exhaustive pure tests for §7.6 weighted scoring and bands. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { KeywordsFile } from '../src/config/schema.js';
import { scoreJob } from '../src/score/engine.js';

const seed: KeywordsFile = {
  title: {
    'new grad': 6,
    'software engineer': 5,
    junior: 4,
    '2026': 3,
    backend: 3,
  },
  description: {
    python: 3,
    typescript: 3,
    react: 3,
    mentorship: 2,
  },
  negative: {
    senior: 8,
    staff: 8,
  },
};

test('validated seed-profile example lands in band A with exact math', () => {
  const result = scoreJob(
    {
      title: 'New Grad Software Engineer 2026',
      description: 'Python, TypeScript, React, and mentorship are central to this role.',
    },
    seed,
  );

  assert.equal(result.score, 39);
  assert.equal(result.band, 'A');
  assert.equal(result.titleOnly, false);
  assert.deepEqual(
    [...result.matchedKeywords].sort(),
    [
      'new grad',
      'software engineer',
      '2026',
      'python',
      'typescript',
      'react',
      'mentorship',
    ].sort(),
  );
});

test('negative keywords penalize title and description together', () => {
  const result = scoreJob(
    { title: 'Senior Staff Engineer', description: 'Build reliable services.' },
    seed,
  );

  assert.equal(result.score, -32);
  assert.equal(result.band, 'D');
  assert.deepEqual(result.matchedKeywords, ['senior', 'staff']);

  const descriptionPenalty = scoreJob(
    { title: 'Backend Engineer', description: 'This is a senior position.' },
    seed,
  );
  assert.equal(descriptionPenalty.score, -10);
  assert.deepEqual(descriptionPenalty.matchedKeywords, ['backend', 'senior']);
});

test('title-only jobs score their title and carry the uncertainty flag', () => {
  const result = scoreJob({ title: 'Junior Backend Engineer', description: '   ' }, seed);

  assert.equal(result.score, 14);
  assert.equal(result.band, 'C');
  assert.equal(result.titleOnly, true);
  assert.deepEqual(result.matchedKeywords, ['junior', 'backend']);
});

test('every band boundary is inclusive at its specified threshold', () => {
  assert.equal(scoreAt(30).band, 'A');
  assert.equal(scoreAt(29).band, 'B');
  assert.equal(scoreAt(18).band, 'B');
  assert.equal(scoreAt(17).band, 'C');
  assert.equal(scoreAt(8).band, 'C');
  assert.equal(scoreAt(7).band, 'D');
});

test('matching is case-insensitive substring matching', () => {
  const upper = scoreJob({ title: 'SOFTWARE ENGINEER — BACKEND' }, seed);
  const lower = scoreJob({ title: 'software engineer — backend' }, seed);

  assert.deepEqual(upper, lower);
  assert.deepEqual(upper.matchedKeywords, ['software engineer', 'backend']);
  assert.equal(upper.score, 16);
});

test('matched keywords contain each firing signal exactly once across lists', () => {
  const keywords: KeywordsFile = {
    title: { product: 2, engineer: 1 },
    description: { product: 3 },
    negative: { product: 4, unpaid: 10 },
  };
  const result = scoreJob(
    { title: 'Product Engineer', description: 'Product role, not unpaid.' },
    keywords,
  );

  assert.deepEqual(result.matchedKeywords, ['product', 'engineer', 'unpaid']);
  assert.equal(new Set(result.matchedKeywords).size, result.matchedKeywords.length);
});

function scoreAt(score: number) {
  return scoreJob(
    { title: 'Role', description: 'boundary' },
    { title: {}, description: { boundary: score }, negative: {} },
  );
}
