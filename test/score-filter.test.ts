/** Pure fixture tests for the hard-exclude/location suppression gate — zero DB/IO. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { KeywordsFile } from '../src/config/schema.js';
import { applyHardFilters } from '../src/score/filter.js';

const EMPTY_HARD_EXCLUDE: KeywordsFile['hardExclude'] = { title: [], description: [] };
const EMPTY_LOCATIONS: KeywordsFile['locations'] = {
  allow: [],
  block: [],
  allowUnknownLocation: true,
};

test('a title containing a hard-exclude term excludes with a reason naming the match', () => {
  const verdict = applyHardFilters(
    { title: 'Senior Backend Engineer', description: null, location: null },
    { title: ['senior'], description: [] },
    EMPTY_LOCATIONS,
  );
  assert.equal(verdict.excluded, true);
  assert.match(verdict.reason ?? '', /hard-exclude title: senior/);
});

test('a description containing a hard-exclude term excludes', () => {
  const verdict = applyHardFilters(
    { title: 'Backend Engineer', description: 'PhD required for this role.', location: null },
    { title: [], description: ['phd required'] },
    EMPTY_LOCATIONS,
  );
  assert.equal(verdict.excluded, true);
  assert.match(verdict.reason ?? '', /hard-exclude description: phd required/);
});

test('word-boundary correctness: "staff" does not fire inside "staffing"', () => {
  const verdict = applyHardFilters(
    { title: 'Staffing Coordinator', description: null, location: null },
    { title: ['staff'], description: [] },
    EMPTY_LOCATIONS,
  );
  assert.equal(verdict.excluded, false);
});

test('a location matching the block list excludes, naming the match', () => {
  const verdict = applyHardFilters(
    { title: 'Engineer', description: null, location: 'Bengaluru, India' },
    EMPTY_HARD_EXCLUDE,
    { allow: [], block: ['india'], allowUnknownLocation: true },
  );
  assert.equal(verdict.excluded, true);
  assert.match(verdict.reason ?? '', /location blocked: india/);
});

test('word-boundary correctness: a location term does not fire inside a compound word', () => {
  const verdict = applyHardFilters(
    { title: 'Engineer', description: null, location: 'Indianapolis, IN' },
    EMPTY_HARD_EXCLUDE,
    { allow: [], block: ['india'], allowUnknownLocation: true },
  );
  assert.equal(verdict.excluded, false);
});

test('an unknown location is never excluded when allowUnknownLocation is true', () => {
  const verdict = applyHardFilters(
    { title: 'Engineer', description: null, location: null },
    EMPTY_HARD_EXCLUDE,
    { allow: [], block: ['india'], allowUnknownLocation: true },
  );
  assert.equal(verdict.excluded, false);
});

test('an unknown location excludes when allowUnknownLocation is false and allow is set', () => {
  const verdict = applyHardFilters(
    { title: 'Engineer', description: null, location: '' },
    EMPTY_HARD_EXCLUDE,
    { allow: ['united states'], block: [], allowUnknownLocation: false },
  );
  assert.equal(verdict.excluded, true);
  assert.match(verdict.reason ?? '', /location unknown/);
});

test('a non-empty allow list excludes a job matching neither allow nor block', () => {
  const verdict = applyHardFilters(
    { title: 'Engineer', description: null, location: 'Berlin, Germany' },
    EMPTY_HARD_EXCLUDE,
    { allow: ['united states', 'remote'], block: [], allowUnknownLocation: true },
  );
  assert.equal(verdict.excluded, true);
  assert.match(verdict.reason ?? '', /location not in allow list: Berlin, Germany/);
});

test('a job matching an allow entry passes', () => {
  const verdict = applyHardFilters(
    { title: 'Engineer', description: null, location: 'Remote - United States' },
    EMPTY_HARD_EXCLUDE,
    { allow: ['united states', 'remote'], block: [], allowUnknownLocation: true },
  );
  assert.equal(verdict.excluded, false);
  assert.equal(verdict.reason, null);
});

test('block always wins over allow, even when the location also matches an allow entry', () => {
  const verdict = applyHardFilters(
    { title: 'Engineer', description: null, location: 'Remote - India' },
    EMPTY_HARD_EXCLUDE,
    { allow: ['remote'], block: ['india'], allowUnknownLocation: true },
  );
  assert.equal(verdict.excluded, true);
  assert.match(verdict.reason ?? '', /location blocked: india/);
});

test('empty hardExclude and locations (the default) never exclude anything', () => {
  const verdict = applyHardFilters(
    {
      title: 'Senior Staff Principal Director Engineer',
      description: 'PhD required, security clearance needed, 10+ years experience.',
      location: 'India',
    },
    EMPTY_HARD_EXCLUDE,
    EMPTY_LOCATIONS,
  );
  assert.deepEqual(verdict, { excluded: false, reason: null });
});
