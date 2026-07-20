/** Verifies the ordered rule classifier, especially reject-before-confirm and ignore-first. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { classify } from '../src/gmail/classify.js';
import type { EmailClass, EmailMeta } from '../src/gmail/types.js';

interface Fixture {
  name: string;
  email: EmailMeta;
  expected: { type: EmailClass | null; confidence: 'high' | 'low' };
}

const fixtures: readonly Fixture[] = JSON.parse(
  readFileSync(new URL('fixtures/gmail/classification.json', import.meta.url), 'utf8'),
);

test('classification fixture suite passes 11/11', () => {
  assert.equal(fixtures.length, 11);
  for (const fixture of fixtures) {
    const result = classify(fixture.email);
    assert.deepEqual(
      { type: result.type, confidence: result.confidence },
      fixture.expected,
      fixture.name,
    );
  }
});

test('a rejection classifies as rejected even though it also reads like a confirmation', () => {
  const email: EmailMeta = {
    threadId: 't3',
    date: '2026-01-07T11:00:00.000Z',
    sender: 'recruiting@acme.example.com',
    subject: 'Update on your application to Acme',
    snippet:
      'Thank you for your interest in the Software Engineer role at Acme. After careful ' +
      'consideration, we have decided to move forward with other candidates.',
  };
  assert.equal(classify(email).type, 'rejected');
});

test('a job-alert digest classifies as ignore even when its subject reads as interview-ish', () => {
  const email: EmailMeta = {
    threadId: 't1',
    date: '2026-01-05T09:00:00.000Z',
    sender: 'jobalerts-noreply@linkedin.com',
    subject: '5 new interview-ready jobs matching your search',
    snippet: 'New jobs recommended for you based on your profile. See interview tips inside.',
  };
  assert.equal(classify(email).type, 'ignore');
});

test('a fall-through email is low confidence and null, not silently ignore', () => {
  const email: EmailMeta = {
    threadId: 't11',
    date: '2026-01-15T19:00:00.000Z',
    sender: 'a-friend@example.com',
    subject: 'Congrats on the new role!',
    snippet: "Saw your update, congrats! Let's catch up soon.",
  };
  const result = classify(email);
  assert.equal(result.type, null);
  assert.equal(result.confidence, 'low');
});

test('classification never imports company or role extraction', async () => {
  const source = readFileSync(new URL('../src/gmail/classify.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /extract-company/);
});
