/** Verifies HTTP fetch policy without performing network requests. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { HTTP_USER_AGENT } from '../src/constants.js';
import { HttpError } from '../src/util/errors.js';
import { UndiciHttpClient } from '../src/util/http.js';

test('HTTP client follows policy and returns non-2xx response data', async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    capturedInit = init;
    return {
      url: 'https://final.example/jobs',
      status: 503,
      text: async () => 'temporarily unavailable',
      headers: new Headers({ 'content-type': 'text/plain' }),
    } as Response;
  };

  try {
    const result = await new UndiciHttpClient().fetchText('https://start.example/careers', {
      timeoutMs: 250,
    });
    assert.deepEqual(result, {
      finalUrl: 'https://final.example/jobs',
      status: 503,
      body: 'temporarily unavailable',
      contentType: 'text/plain',
      headers: { 'content-type': 'text/plain' },
    });
    assert.equal(capturedInit?.redirect, 'follow');
    assert.equal(new Headers(capturedInit?.headers).get('user-agent'), HTTP_USER_AGENT);
    assert.ok(capturedInit?.signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP client wraps network failures in HttpError', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('socket closed');
  };

  try {
    await assert.rejects(
      () => new UndiciHttpClient().fetchText('https://example.com'),
      (error: unknown) => error instanceof HttpError && error.message.includes('socket closed'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP client posts JSON through the same request policy', async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    capturedInit = init;
    return {
      url: 'https://tenant.wd1.myworkdayjobs.com/wday/cxs/tenant/site/jobs',
      status: 200,
      text: async () => '{"total":0,"jobPostings":[]}',
      headers: new Headers({ 'content-type': 'application/json' }),
    } as Response;
  };

  try {
    await new UndiciHttpClient().postJson('https://example.com/jobs', {
      limit: 20,
      offset: 0,
    });
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(new Headers(capturedInit?.headers).get('content-type'), 'application/json');
    assert.equal(new Headers(capturedInit?.headers).get('user-agent'), HTTP_USER_AGENT);
    assert.equal(capturedInit?.body, '{"limit":20,"offset":0}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
