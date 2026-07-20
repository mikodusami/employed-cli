/** Verifies pure candidate ranking without network or browser dependencies. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { findJobBrowseLinks, findJobDetailLinks } from '../src/scrape/crawl.js';

test('browse candidates resolve relative URLs, exclude noise, deduplicate, and cap at two', () => {
  const html = `
    <a href="mailto:jobs@example.com">Email jobs</a>
    <a href="https://linkedin.com/company/example/jobs">LinkedIn jobs</a>
    <a href="#jobs">Jump to jobs</a>
    <a href="/jobs">Open jobs</a>
    <a href="/jobs">Open jobs again</a>
    <a href="/careers/openings">Careers</a>
    <a href="/opportunities">Opportunities</a>
  `;

  assert.deepEqual(findJobBrowseLinks(html, 'https://example.com/about'), [
    'https://example.com/jobs',
    'https://example.com/careers/openings',
  ]);
});

test('detail candidates accept explicit and repeated path signals and cap at three', () => {
  const html = `
    <a href="/jobs/101">Engineer</a>
    <a href="/teams/platform/alpha">Platform role</a>
    <a href="/teams/platform/beta">Backend role</a>
    <a href="/teams/platform/gamma">Frontend role</a>
    <a href="/about">About</a>
  `;

  assert.deepEqual(findJobDetailLinks(html, 'https://example.com/jobs'), [
    'https://example.com/jobs/101',
    'https://example.com/teams/platform/alpha',
    'https://example.com/teams/platform/beta',
  ]);
});
