/** Verifies the two-tier company extractor, including the three named tricky cases. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { extractCompany, extractRole } from '../src/gmail/extract-company.js';
import type { EmailMeta } from '../src/gmail/types.js';

interface Fixture {
  name: string;
  email: EmailMeta;
  expectedCompany: string | null;
}

const fixtures: readonly Fixture[] = JSON.parse(
  readFileSync(new URL('fixtures/gmail/extraction.json', import.meta.url), 'utf8'),
);

test('extraction fixture suite passes 9/9', () => {
  assert.equal(fixtures.length, 9);
  for (const fixture of fixtures) {
    assert.equal(extractCompany(fixture.email), fixture.expectedCompany, fixture.name);
  }
});

test('tier 2 resolves Red Hat from a bare Workday tenant sender', () => {
  const email: EmailMeta = {
    threadId: 'e2',
    date: '2026-01-15T12:00:00.000Z',
    sender: 'redhat@myworkday.com',
    subject: 'Your Workday application status has been updated',
    snippet: 'There has been an update to your application.',
  };
  assert.equal(extractCompany(email), 'Red Hat');
});

test('tier 2 resolves Federal Reserve Bank of Atlanta from a bare Workday tenant sender', () => {
  const email: EmailMeta = {
    threadId: 'e3',
    date: '2026-01-15T12:05:00.000Z',
    sender: 'rb@myworkday.com',
    subject: 'Your Workday application status has been updated',
    snippet: 'There has been an update to your application.',
  };
  assert.equal(extractCompany(email), 'Federal Reserve Bank of Atlanta');
});

test('tier 1 resolves Whatnot from an Ashby subject line', () => {
  const email: EmailMeta = {
    threadId: 'e1',
    date: '2026-01-14T18:00:00.000Z',
    sender: 'no-reply@ashbyhq.com',
    subject: 'Thank you for applying to Whatnot!',
    snippet: 'Thank you for applying. Our team will review your application shortly.',
  };
  assert.equal(extractCompany(email), 'Whatnot');
});

test('extractRole reads a title out of the subject line independently of company', () => {
  const email: EmailMeta = {
    threadId: 'r1',
    date: '2026-01-11T15:00:00.000Z',
    sender: 'recruiting@soylent.example.com',
    subject: 'Interview invitation for the Senior Software Engineer position at Soylent',
    snippet: 'We would like to invite you to interview.',
  };
  assert.equal(extractRole(email), 'Senior Software Engineer');
});

test('extractRole returns null when the subject carries no recognizable title', () => {
  const email: EmailMeta = {
    threadId: 'r2',
    date: '2026-01-16T09:00:00.000Z',
    sender: 'jobs@hire.lever.co',
    subject: 'Thanks for applying to Stripe!',
    snippet: 'We appreciate your interest in joining our team.',
  };
  assert.equal(extractRole(email), null);
});

test('extraction never imports the classifier', async () => {
  const source = readFileSync(new URL('../src/gmail/extract-company.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /classify\.js/);
});
