/** Verifies polite scheduling, retries, conditional caching, and robots enforcement offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDb } from '../src/db/index.js';
import { SignatureDetector } from '../src/scrape/detect.js';
import {
  CachingHttpClient,
  PoliteHttpClient,
  RetryHttpClient,
  RobotsGate,
} from '../src/util/http.js';
import type { FetchOpts, FetchResult, HttpClient } from '../src/util/http.js';

const okResult = (url: string): FetchResult => ({
  finalUrl: url,
  status: 200,
  body: 'ok',
  contentType: 'text/plain',
});

test('politeness serializes domains, overlaps domains, and honors the global cap', async () => {
  let active = 0;
  let maxActive = 0;
  const starts: string[] = [];
  const gaps: number[] = [];
  const inner = client(async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    starts.push(url);
    await Promise.resolve();
    active -= 1;
    return okResult(url);
  });
  const polite = new PoliteHttpClient(inner, {
    concurrency: 2,
    jitterMs: { min: 500, max: 1500 },
    random: () => 0,
    sleep: async (milliseconds) => {
      gaps.push(milliseconds);
    },
  });

  await Promise.all([
    polite.fetchText('https://one.example.com/1'),
    polite.fetchText('https://one.example.com/2'),
    polite.fetchText('https://one.example.com/3'),
    polite.fetchText('https://two.example.org/1'),
    polite.fetchText('https://two.example.org/2'),
    polite.fetchText('https://two.example.org/3'),
  ]);

  assert.equal(maxActive, 2);
  assert.deepEqual(starts.filter((url) => url.includes('example.com')), [
    'https://one.example.com/1',
    'https://one.example.com/2',
    'https://one.example.com/3',
  ]);
  assert.deepEqual(gaps, [500, 500, 500, 500]);
});

test('retry handles transient responses and leaves 404 untouched', async () => {
  const delays: number[] = [];
  let transientCalls = 0;
  const transient = client(async (url) => {
    transientCalls += 1;
    return { ...okResult(url), status: transientCalls < 3 ? 429 : 200 };
  });
  const retry = new RetryHttpClient(transient, {
    maxAttempts: 3,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  assert.equal((await retry.fetchText('https://example.com/jobs')).status, 200);
  assert.equal(transientCalls, 3);
  assert.deepEqual(delays, [1000, 2000]);

  let missingCalls = 0;
  const missing = new RetryHttpClient(
    client(async (url) => {
      missingCalls += 1;
      return { ...okResult(url), status: 404 };
    }),
    { maxAttempts: 3, sleep: async () => undefined },
  );
  assert.equal((await missing.fetchText('https://example.com/missing')).status, 404);
  assert.equal(missingCalls, 1);
});

test('cache revalidates GET responses and bypasses POST requests', async () => {
  const database = createDb(':memory:');
  const cacheHits: string[] = [];
  const seenOptions: FetchOpts[] = [];
  let getCalls = 0;
  let postCalls = 0;
  const inner: HttpClient = {
    async fetchText(url, options = {}) {
      seenOptions.push(options);
      getCalls += 1;
      if (getCalls === 1) {
        return { ...okResult(url), body: 'cached body', headers: { etag: '"v1"' } };
      }
      return { ...okResult(url), status: 304, body: '' };
    },
    async postJson(url) {
      postCalls += 1;
      return okResult(url);
    },
  };
  const cache = new CachingHttpClient(
    inner,
    database,
    () => new Date('2026-07-19T00:00:00Z'),
    (url) => cacheHits.push(url),
  );

  await cache.fetchText('https://example.com/jobs');
  const second = await cache.fetchText('https://example.com/jobs');
  await cache.postJson('https://example.com/jobs', { offset: 0 });

  assert.equal(second.body, 'cached body');
  assert.equal(second.fromCache, true);
  assert.deepEqual(cacheHits, ['https://example.com/jobs']);
  assert.equal(seenOptions[1]?.headers?.['if-none-match'], '"v1"');
  assert.equal(postCalls, 1);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM http_cache').get().count,
    1,
  );
  database.close();
});

test('robots denial marks detection manual while 404 allows detection', async () => {
  let robotsCalls = 0;
  const disallowing = routedClient((url) => {
    if (url.endsWith('/robots.txt')) {
      robotsCalls += 1;
      return { ...okResult(url), body: 'User-agent: *\nDisallow: /jobs\nAllow: /jobs/public' };
    }
    return { ...okResult(url), body: '' };
  });
  const gate = new RobotsGate(disallowing);
  assert.equal(await gate.isAllowed('https://example.com/jobs/public/1'), true);
  const denied = await new SignatureDetector(disallowing, gate, true).detect(
    'https://example.com/jobs/private',
  );
  assert.equal(denied.method, 'manual');
  assert.match(denied.detail ?? '', /robots\.txt disallows/);
  assert.equal(robotsCalls, 1);

  const allowing = routedClient((url) =>
    url.endsWith('/robots.txt')
      ? { ...okResult(url), status: 404 }
      : {
          ...okResult(url),
          finalUrl: 'https://jobs.ashbyhq.com/example',
          body: '',
        },
  );
  const detected = await new SignatureDetector(allowing, new RobotsGate(allowing), true).detect(
    'https://example.org/jobs',
  );
  assert.equal(detected.method, 'ashby');
});

function client(fetchText: (url: string) => Promise<FetchResult>): HttpClient {
  return {
    fetchText,
    postJson: async (url) => fetchText(url),
  };
}

function routedClient(route: (url: string) => FetchResult): HttpClient {
  return {
    fetchText: async (url) => route(url),
    postJson: async (url) => route(url),
  };
}
