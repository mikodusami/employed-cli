/** Optional live ATS smoke checks, disabled during the normal network-free suite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { CompanyRow, ScrapeMethod } from '../src/db/index.js';
import { getSource } from '../src/scrape/adapters/index.js';
import { SignatureDetector } from '../src/scrape/detect.js';
import { UndiciHttpClient } from '../src/util/http.js';

const isLiveEnabled = process.env.EMPLOYED_LIVE_ATS_TESTS === '1';

test(
  'live detector and adapters recognize representative public ATS boards',
  { skip: isLiveEnabled ? false : 'set EMPLOYED_LIVE_ATS_TESTS=1 to enable network checks' },
  async () => {
    const detector = new SignatureDetector(new UndiciHttpClient());
    const cases = [
      ['Anthropic', 'https://job-boards.greenhouse.io/anthropic', 'greenhouse', 'anthropic'],
      ['Linear', 'https://jobs.ashbyhq.com/linear', 'ashby', 'linear'],
      ['Visa', 'https://careers.smartrecruiters.com/Visa', 'smartrecruiters', 'Visa'],
      ['Airbnb', 'https://careers.airbnb.com', 'greenhouse', 'airbnb'],
    ] as const;

    for (const [name, url, method, slug] of cases) {
      const result = await detector.detect({ name, careers_url: url });
      assert.equal(result.method, method);
      assert.equal(result.slug, slug);
    }

    const adapterCases = [
      ['greenhouse', 'anthropic'],
      ['lever', 'highspot'],
      ['ashby', 'linear'],
      ['ashby', 'notion'],
      ['ashby', 'ramp'],
      ['smartrecruiters', 'Visa'],
      ['smartrecruiters', 'Ubisoft2'],
      ['smartrecruiters', 'BoschGroup'],
      ['recruitee', 'freeday'],
      ['recruitee', 'polaroid'],
      ['recruitee', 'riverflex'],
      ['workday', 'nvidia|wd5|NVIDIAExternalCareerSite'],
      ['workday', 'salesforce|wd12|External_Career_Site'],
      ['workday', 'citi|wd5|2'],
    ] as const;
    for (const [method, slug] of adapterCases) {
      const source = getSource(method, { http: new UndiciHttpClient() });
      assert.ok(source);
      const postings = await source.fetchPostings(company(method, slug));
      assert.ok(postings.length > 0);
      assert.ok(postings[0]?.title);
      assert.ok(postings[0]?.url);
    }
  },
);

function company(method: ScrapeMethod, slug: string): CompanyRow {
  return {
    id: 1,
    name: 'Live Fixture',
    slug,
    careers_url: 'https://example.com/careers',
    tier: 'B',
    scrape_method: method,
    scraper_config: null,
    health: 'untested',
    consecutive_failures: 0,
    last_success: null,
    last_yield: null,
    created_at: new Date().toISOString(),
  };
}
