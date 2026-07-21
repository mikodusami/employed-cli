/** Verifies the ATS detector shell using only injected HTTP fakes. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_DETECTION_REQUESTS, SignatureDetector } from '../src/scrape/detect.js';
import { HttpError } from '../src/util/errors.js';
import type { FetchResult, HttpClient } from '../src/util/http.js';

class ResultHttpClient implements HttpClient {
  public constructor(private readonly result: FetchResult) {}

  public async fetchText(): Promise<FetchResult> {
    return this.result;
  }
}

class FailingHttpClient implements HttpClient {
  public async fetchText(): Promise<FetchResult> {
    throw new HttpError('connection refused');
  }
}

test('detector matches against the response final URL after redirects', async () => {
  const detector = new SignatureDetector(
    new ResultHttpClient({
      finalUrl: 'https://jobs.lever.co/redirected-company',
      status: 200,
      body: '<html></html>',
      contentType: 'text/html',
    }),
  );
  const result = await detector.detect(company('Redirected', 'https://example.com/careers'));

  assert.equal(result.method, 'lever');
  assert.equal(result.slug, 'redirected-company');
});

test('detector converts non-2xx responses into unknown result data', async () => {
  const detector = new SignatureDetector(
    new ResultHttpClient({
      finalUrl: 'https://example.com/missing',
      status: 503,
      body: 'unavailable',
      contentType: 'text/plain',
    }),
  );
  const result = await detector.detect(company('Missing', 'https://example.com/careers'));

  assert.deepEqual(result, {
    method: 'unknown',
    slug: null,
    detail: 'fetch failed: HTTP 503',
  });
});

test('detector converts network errors into unknown result data', async () => {
  const result = await new SignatureDetector(new FailingHttpClient()).detect(
    company('Unreachable', 'https://unreachable.example'),
  );

  assert.deepEqual(result, {
    method: 'unknown',
    slug: null,
    detail: 'fetch failed: connection refused',
  });
});

test('detector returns a diagnostic unknown for an unmatched page', async () => {
  const detector = new SignatureDetector(
    new ResultHttpClient({
      finalUrl: 'https://example.com/careers',
      status: 200,
      body: '<html><h1>Careers</h1></html>',
      contentType: 'text/html',
    }),
  );

  const result = await detector.detect(company('Example', 'https://example.com'));
  assert.equal(result.detail, 'no signature found after crawl (1 requests)');
});

test('known ATS override returns before any HTTP request', async () => {
  let calls = 0;
  const http: HttpClient = {
    fetchText: async () => {
      calls += 1;
      throw new Error('override must not fetch');
    },
    postJson: async () => {
      throw new Error('unexpected POST');
    },
  };
  const detector = new SignatureDetector(http, undefined, false, {
    airbnb: { method: 'greenhouse', slug: 'airbnb' },
  });

  const result = await detector.detect(company('Airbnb', 'https://careers.airbnb.com'));

  assert.deepEqual(result, {
    method: 'greenhouse',
    slug: 'airbnb',
    detail: 'known-ats override',
  });
  assert.equal(calls, 0);
});

test('detector follows landing to browse to detail and reports its crawl path', async () => {
  const pages = new Map<string, string>([
    [
      'https://careers.example.com',
      '<a href="/jobs">Browse opportunities</a>',
    ],
    [
      'https://careers.example.com/jobs',
      [1, 2, 3].map((id) => `<a href="/jobs/${id}">Role ${id}</a>`).join(''),
    ],
    [
      'https://careers.example.com/jobs/1',
      '<a href="https://job-boards.greenhouse.io/airbnb">Apply</a>',
    ],
  ]);
  const detector = new SignatureDetector(routedHttp(pages));

  const result = await detector.detect(company('Airbnb', 'https://careers.example.com'));

  assert.equal(result.method, 'greenhouse');
  assert.equal(result.slug, 'airbnb');
  assert.match(result.detail ?? '', /matched at depth 2/);
  assert.match(result.detail ?? '', /careers\.example\.com\/jobs\/1/);
});

test('pathological crawl never exceeds the hard request cap', async () => {
  let calls = 0;
  const http: HttpClient = {
    fetchText: async (url) => {
      calls += 1;
      const body = url.endsWith('/root')
        ? '<a href="/jobs-a">Jobs A</a><a href="/jobs-b">Jobs B</a>'
        : [1, 2, 3, 4].map((id) => `<a href="${url}/positions/${id}">Role</a>`).join('');
      return ok(url, body);
    },
    postJson: async () => {
      throw new Error('unexpected POST');
    },
  };

  const result = await new SignatureDetector(http).detect(
    company('Pathological', 'https://example.com/root'),
  );

  assert.equal(result.method, 'unknown');
  assert.equal(calls, MAX_DETECTION_REQUESTS);
  assert.match(result.detail ?? '', /5 requests/);
});

test('a hanging detection fetch hits its deadline and reports the failed stage', async () => {
  const events: Array<{ message: string; level?: string }> = [];
  const http: HttpClient = {
    fetchText: async () => new Promise<FetchResult>(() => undefined),
    postJson: async () => new Promise<FetchResult>(() => undefined),
  };
  const detector = new SignatureDetector(
    http,
    undefined,
    false,
    {},
    (_scope, message, _data, level) => events.push({ message, level }),
    20,
  );

  const result = await detector.detect(company('Hanging', 'https://example.com/careers'));

  assert.equal(result.method, 'unknown');
  assert.match(result.detail ?? '', /timed out after 20ms/);
  assert.deepEqual(events.map(({ message }) => message), [
    'fetching crawl page',
    'careers-page detection failed',
  ]);
  assert.equal(events[1]?.level, 'error');
});

function company(name: string, careersUrl: string) {
  return { name, careers_url: careersUrl };
}

function routedHttp(pages: ReadonlyMap<string, string>): HttpClient {
  return {
    fetchText: async (url) => ok(url, pages.get(url) ?? '<html></html>'),
    postJson: async () => {
      throw new Error('unexpected POST');
    },
  };
}

function ok(url: string, body: string): FetchResult {
  return { finalUrl: url, status: 200, body, contentType: 'text/html' };
}
