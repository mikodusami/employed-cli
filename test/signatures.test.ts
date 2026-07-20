/** Verifies pure ATS signature matching against saved HTML fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ScrapeMethod } from '../src/db/index.js';
import { matchSignatures } from '../src/scrape/signatures.js';

interface FixtureCase {
  fileName: string;
  method: ScrapeMethod;
  slug: string;
}

const fixtureCases: readonly FixtureCase[] = [
  { fileName: 'greenhouse.html', method: 'greenhouse', slug: 'acme' },
  { fileName: 'lever.html', method: 'lever', slug: 'acme-lever' },
  { fileName: 'ashby.html', method: 'ashby', slug: 'acme-ashby' },
  { fileName: 'workday.html', method: 'workday', slug: 'acme|wd5|External_Careers' },
  {
    fileName: 'smartrecruiters.html',
    method: 'smartrecruiters',
    slug: 'AcmeSmart',
  },
  { fileName: 'recruitee.html', method: 'recruitee', slug: 'acme' },
];

test('matches all six ATS fixtures with the expected slug', async (context) => {
  for (const fixtureCase of fixtureCases) {
    await context.test(fixtureCase.method, () => {
      const match = matchSignatures(
        'https://example.com/careers',
        readFixture(fixtureCase.fileName),
      );
      assert.equal(match?.method, fixtureCase.method);
      assert.equal(match?.slug, fixtureCase.slug);
      assert.match(match?.detail ?? '', /HTML/);
    });
  }
});

test('uses a redirected final URL and prioritizes Greenhouse first', () => {
  const match = matchSignatures(
    'https://boards.greenhouse.io/redirect-company/jobs/42',
    readFixture('lever.html'),
  );
  assert.deepEqual(match, {
    method: 'greenhouse',
    slug: 'redirect-company',
    detail: 'greenhouse signature matched in final URL',
  });
});

test('returns null for a custom careers page', () => {
  assert.equal(
    matchSignatures('https://example.com/careers', readFixture('custom.html')),
    null,
  );
});

function readFixture(fileName: string): string {
  return readFileSync(new URL(`fixtures/detection/${fileName}`, import.meta.url), 'utf8');
}
