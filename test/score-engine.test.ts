/** Exhaustive pure tests for §7.6 weighted, word-boundary-aware scoring and bands. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { KeywordsFile } from '../src/config/schema.js';
import { buildKeywordRegex, scoreJob } from '../src/score/engine.js';

const EMPTY_FILTERS = {
  hardExclude: { title: [], description: [] },
  locations: { allow: [], block: [], allowUnknownLocation: true },
} as const;

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
  ...EMPTY_FILTERS,
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
    ...EMPTY_FILTERS,
  };
  const result = scoreJob(
    { title: 'Product Engineer', description: 'Product role, not unpaid.' },
    keywords,
  );

  assert.deepEqual(result.matchedKeywords, ['product', 'engineer', 'unpaid']);
  assert.equal(new Set(result.matchedKeywords).size, result.matchedKeywords.length);
});

test('buildKeywordRegex is word-boundary-aware: short keywords skip longer words', () => {
  assert.equal(buildKeywordRegex('ai').test('maintaining a service'), false);
  assert.equal(buildKeywordRegex('ai').test('domain expertise'), false);
  assert.equal(buildKeywordRegex('ai').test('certain skills'), false);
  assert.equal(buildKeywordRegex('ai').test('AI Engineer'), true);

  assert.equal(buildKeywordRegex('api').test('capital markets'), false);
  assert.equal(buildKeywordRegex('api').test('rapid growth'), false);
  assert.equal(buildKeywordRegex('api').test('build a REST API'), true);

  assert.equal(buildKeywordRegex('sql').test('nosql database'), false);
  assert.equal(buildKeywordRegex('sql').test('write SQL queries'), true);

  assert.equal(buildKeywordRegex('staff').test('staffing agency'), false);
  assert.equal(buildKeywordRegex('staff').test('Staff Engineer'), true);
});

test('buildKeywordRegex matches a keyword with a non-word character as a whole phrase', () => {
  assert.equal(buildKeywordRegex('ci/cd').test('we value ci/cd practices'), true);
  assert.equal(buildKeywordRegex('ci/cd').test('CI/CD pipeline'), true);
  assert.equal(buildKeywordRegex('ci/cd').test('ci/cdx'), false);
  assert.equal(buildKeywordRegex('ci/cd').test('xci/cd'), false);
});

test('scoreJob counts word-boundary hits only: ai/api/sql substrings never inflate score', () => {
  const keywords: KeywordsFile = {
    title: {},
    description: { ai: 2, api: 2, sql: 2 },
    negative: {},
    ...EMPTY_FILTERS,
  };
  const result = scoreJob(
    {
      title: 'Backend Engineer',
      description: 'Maintaining a domain-driven, certain, capital, rapid, nosql pipeline.',
    },
    keywords,
  );

  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedKeywords, []);
});

test('an indirect early-career phrase in the description fires and lifts the score', () => {
  const keywords: KeywordsFile = {
    title: {},
    description: { 'equivalent practical experience': 3 },
    negative: {},
    ...EMPTY_FILTERS,
  };
  const result = scoreJob(
    {
      title: 'Software Engineer',
      description: 'A degree is preferred, or equivalent practical experience.',
    },
    keywords,
  );

  assert.equal(result.score, 3);
  assert.deepEqual(result.matchedKeywords, ['equivalent practical experience']);
});

test('a title with no seniority language scores from description signals alone', () => {
  const keywords: KeywordsFile = {
    title: {},
    description: { python: 3, 'no experience required': 3 },
    negative: { senior: 8 },
    ...EMPTY_FILTERS,
  };
  const result = scoreJob(
    { title: 'Engineer', description: 'Python role. No experience required.' },
    keywords,
  );

  assert.equal(result.score, 6);
  assert.deepEqual(result.matchedKeywords, ['python', 'no experience required']);
});

function scoreAt(score: number) {
  return scoreJob(
    { title: 'Role', description: 'boundary' },
    { title: {}, description: { boundary: score }, negative: {}, ...EMPTY_FILTERS },
  );
}
