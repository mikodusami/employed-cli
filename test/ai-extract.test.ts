/** Verifies deterministic extraction from common model-response wrappers. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJsonBlock } from '../src/ai/index.js';

test('extracts fenced JSON', () => {
  assert.equal(extractJsonBlock('Result:\n```json\n{"ok":true}\n```'), '{"ok":true}');
});

test('extracts a bare object', () => {
  assert.equal(extractJsonBlock('{"name":"Ada"}'), '{"name":"Ada"}');
});

test('extracts a prose-wrapped object', () => {
  assert.equal(extractJsonBlock('Here is the result: {"count":2} done.'), '{"count":2}');
});

test('balances nested structures and braces inside strings', () => {
  const json = '{"text":"literal } and [ braces","nested":{"items":[1,{"x":2}]}}';
  assert.equal(extractJsonBlock(`prefix ${json} suffix`), json);
});

test('returns null when no complete JSON value exists', () => {
  assert.equal(extractJsonBlock('There is no structured response here.'), null);
  assert.equal(extractJsonBlock('incomplete {"value": 1'), null);
});
