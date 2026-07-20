/** Verifies pure canonical posting normalization and dedupe behavior. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeDedupeKey,
  normalizeTitle,
  toJobInput,
} from '../src/scrape/normalize.js';

test('normalizeTitle strips requirement ID variants and collapses whitespace', () => {
  assert.equal(normalizeTitle('Software Engineer (Req #12345)'), 'software engineer');
  assert.equal(normalizeTitle(' Software   Engineer ID:ABC-9 '), 'software engineer');
  assert.equal(normalizeTitle('Software Engineer R-9876'), 'software engineer');
});

test('equivalent titles and URL paths produce the same stable hash', () => {
  const first = computeDedupeKey({
    title: 'Software Engineer (Req #12345)',
    url: 'https://jobs.example.com/openings/software-engineer',
  });
  const second = computeDedupeKey({
    title: 'software engineer',
    url: 'https://another.example/openings/software-engineer',
  });

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('ATS-native external IDs are used verbatim', () => {
  assert.equal(
    computeDedupeKey({
      title: 'Any title',
      url: 'https://example.com/jobs/1',
      externalId: ' ATS-ID-42 ',
    }),
    ' ATS-ID-42 ',
  );
});

test('toJobInput trims fields, removes URL fragments, and stamps discovery dates', () => {
  const input = toJobInput(
    {
      title: '  Product Engineer  ',
      url: 'https://example.com/jobs/42#apply',
      location: '  Remote  ',
      department: ' ',
      description: '  Build useful things. ',
      externalId: '42',
    },
    7,
    '2026-07-19T12:00:00Z',
  );

  assert.deepEqual(input, {
    company_id: 7,
    title: 'Product Engineer',
    url: 'https://example.com/jobs/42',
    location: 'Remote',
    department: null,
    description: 'Build useful things.',
    first_seen: '2026-07-19T12:00:00Z',
    last_seen: '2026-07-19T12:00:00Z',
    dedupe_key: '42',
  });
});
