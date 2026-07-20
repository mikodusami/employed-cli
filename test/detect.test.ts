/** Verifies the ATS detector shell using only injected HTTP fakes. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SignatureDetector } from '../src/scrape/detect.js';
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
  const result = await detector.detect('https://example.com/careers');

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
  const result = await detector.detect('https://example.com/careers');

  assert.deepEqual(result, {
    method: 'unknown',
    slug: null,
    detail: 'fetch failed: HTTP 503',
  });
});

test('detector converts network errors into unknown result data', async () => {
  const result = await new SignatureDetector(new FailingHttpClient()).detect(
    'https://unreachable.example',
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

  const result = await detector.detect('https://example.com');
  assert.equal(result.detail, 'no supported ATS signature found');
});
