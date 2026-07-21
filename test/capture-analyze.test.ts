/** Verifies capture deadlines and compact evidence analysis without live network access. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page, Response } from 'playwright';

import { analyzeCapture, mapLinks, summarizeNetwork } from '../src/scrape/analyze.js';
import { BrowserPool } from '../src/scrape/browser.js';
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

test('network capture records JSON XHR responses with hard caps and truncation', async () => {
  const result = await capturePage(
    'playwright-network',
    'https://example.com/careers',
    new NeverUsedHttp(),
    new EventPool(),
    { staticDeadlineMs: 100, playwrightDeadlineMs: 100 },
  );

  assert.equal(result.networkLog.length, 30);
  assert.equal(result.networkLog[0]?.requestBody?.length, 2_048);
  assert.equal(result.networkLog[0]?.responsePreview.length, 4_096);
  assert.match(result.networkLog[0]?.url ?? '', /api\.example\.com\/jobs/);
});

class NeverUsedHttp implements HttpClient {
  public async fetchText(): Promise<FetchResult> {
    throw new Error('Unexpected static request.');
  }

  public async postJson(): Promise<FetchResult> {
    throw new Error('Unexpected POST request.');
  }
}

class EventPool extends BrowserPool {
  public override async page<Result>(operation: (page: Page) => Promise<Result>): Promise<Result> {
    let responseHandler: ((response: Response) => void) | undefined;
    const html = [1, 2, 3].map((id) => `<a href="/jobs/${id}">Role</a>`).join('');
    const page = {
      on: (event: string, handler: (response: Response) => void) => {
        if (event === 'response') {
          responseHandler = handler;
        }
      },
      goto: async () => {
        for (let index = 0; index < 35; index += 1) {
          responseHandler?.(fakeResponse(index));
        }
        return null;
      },
      content: async () => html,
      url: () => 'https://example.com/careers',
      evaluate: async () => undefined,
      waitForTimeout: async () => undefined,
      waitForLoadState: async () => undefined,
    } as unknown as Page;
    return operation(page);
  }
}

function fakeResponse(index: number): Response {
  return {
    request: () => ({
      resourceType: () => 'xhr',
      method: () => 'POST',
      postData: () => 'x'.repeat(3_000),
    }),
    headers: () => ({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ jobs: 'x'.repeat(5_000) }),
    url: () => `https://api.example.com/jobs?page=${index}`,
    status: () => 200,
  } as unknown as Response;
}
