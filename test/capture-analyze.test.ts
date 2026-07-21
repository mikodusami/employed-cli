/** Verifies capture deadlines and compact evidence analysis without live network access. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeCapture, mapLinks, summarizeNetwork } from '../src/scrape/analyze.js';
import { capturePage, type NetworkEntry } from '../src/scrape/capture/index.js';
import { CaptureTimeoutError } from '../src/util/errors.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

test('a hanging static capture is rejected by its absolute deadline', async () => {
  const hanging: HttpClient = {
    fetchText: async () => new Promise<FetchResult>(() => undefined),
    postJson: async () => new Promise<FetchResult>(() => undefined),
  };
  const started = Date.now();

  await assert.rejects(
    () =>
      capturePage('static', 'https://example.com/careers', hanging, undefined, {
        staticDeadlineMs: 20,
        playwrightDeadlineMs: 20,
      }),
    CaptureTimeoutError,
  );
  assert.ok(Date.now() - started < 500);
});

test('analysis exposes repeated link shapes and bounded JSON network evidence', () => {
  const html = `
    <main>
      <a href="/jobs/101">Engineer</a>
      <a href="/jobs/102">Designer</a>
      <a href="/jobs/103">Product Manager</a>
    </main>`;
  const network: NetworkEntry[] = [
    {
      method: 'GET',
      url: 'https://api.example.com/jobs?offset=0',
      requestBody: null,
      responsePreview: '{"jobs":[{"title":"Engineer"}]}',
      contentType: 'application/json',
      status: 200,
    },
  ];
  const packet = analyzeCapture({
    strategy: 'playwright-network',
    finalUrl: 'https://example.com/careers',
    html,
    networkLog: network,
    navigationPath: ['https://example.com', 'https://example.com/careers'],
  });

  assert.deepEqual(mapLinks(html, 'https://example.com'), [
    {
      pattern: '/jobs/{id}',
      count: 3,
      examples: [
        'https://example.com/jobs/101',
        'https://example.com/jobs/102',
        'https://example.com/jobs/103',
      ],
    },
  ]);
  assert.match(summarizeNetwork(network), /api\.example\.com\/jobs\?offset=0/);
  assert.match(packet.distilledDom, /Engineer/);
  assert.equal(packet.navigationPath.length, 2);
});
