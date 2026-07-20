/** Optional live ATS smoke checks, disabled during the normal network-free suite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SignatureDetector } from '../src/scrape/detect.js';
import { UndiciHttpClient } from '../src/util/http.js';

const isLiveEnabled = process.env.EMPLOYED_LIVE_ATS_TESTS === '1';

test(
  'live detector recognizes representative public ATS boards',
  { skip: isLiveEnabled ? false : 'set EMPLOYED_LIVE_ATS_TESTS=1 to enable network checks' },
  async () => {
    const detector = new SignatureDetector(new UndiciHttpClient());
    const cases = [
      ['https://job-boards.greenhouse.io/anthropic', 'greenhouse', 'anthropic'],
      ['https://jobs.ashbyhq.com/linear', 'ashby', 'linear'],
      ['https://careers.smartrecruiters.com/Visa', 'smartrecruiters', 'Visa'],
    ] as const;

    for (const [url, method, slug] of cases) {
      const result = await detector.detect(url);
      assert.equal(result.method, method);
      assert.equal(result.slug, slug);
    }
  },
);
