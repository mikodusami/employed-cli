/** Verifies deterministic, bounded DOM reduction around repeated links. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { distillDom } from '../src/scrape/distill.js';

test('distiller removes noisy nodes, comments, and non-whitelisted attributes', () => {
  const html = `
    <html><body>
      <!-- remove me --><script>bad()</script><style>.bad{}</style><svg><path /></svg>
      <section id="openings" class="jobs" title="drop" onclick="drop()" data-team="eng">
        <a href="/one" aria-label="One" target="_blank">Software Engineer</a>
        <a href="/two">Product Engineer</a>
      </section>
    </body></html>`;

  const result = distillDom(html);

  assert.doesNotMatch(result.dom, /script|style|svg|remove me|onclick|target=|title=/);
  assert.match(result.dom, /id="openings"/);
  assert.match(result.dom, /data-team="eng"/);
  assert.match(result.dom, /aria-label="One"/);
});

test('distiller is deterministic and caps a window around the dense link region', () => {
  const paddingBefore = `<p>${'before '.repeat(8_000)}</p>`;
  const jobs = `
    <main id="jobs">
      <a href="/jobs/one">Software Engineer</a>
      <a href="/jobs/two">Backend Engineer</a>
      <a href="/jobs/three">Product Engineer</a>
    </main>`;
  const paddingAfter = `<p>${'after '.repeat(8_000)}</p>`;
  const html = `<html><body>${paddingBefore}${jobs}${paddingAfter}</body></html>`;

  const first = distillDom(html);
  const second = distillDom(html);

  assert.deepEqual(first, second);
  assert.ok(Buffer.byteLength(first.dom) <= 35 * 1024);
  assert.match(first.dom, /id="jobs"/);
  assert.match(first.linkDensityHint, /3 links/);
});

test('distiller bounds the saved multi-megabyte careers DOM fixture', () => {
  const html = readFileSync(
    new URL('../fixtures/google/sampledomtree.html', import.meta.url),
    'utf8',
  );

  const result = distillDom(html);

  assert.ok(Buffer.byteLength(result.dom) <= 35 * 1024);
  assert.match(result.linkDensityHint, /subtree containing \d+ links/);
  assert.match(result.dom, /jobs|engineer|software/i);
});
