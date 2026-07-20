/** Verifies acquire/release, collision refusal, and stale-pid reclaim for the run lock. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acquireRunLock, LockHeldError } from '../src/util/lock.js';

test('acquires, records the current pid, and releases cleanly', () => {
  const lockPath = path.join(mkdtempSync(path.join(tmpdir(), 'employed-lock-')), 'run.lock');
  const lock = acquireRunLock(lockPath, 4242);

  assert.ok(existsSync(lockPath));
  assert.equal(readFileSync(lockPath, 'utf8'), '4242');

  lock.release();
  assert.equal(existsSync(lockPath), false);
});

test('refuses a second acquisition while the holder pid is alive', () => {
  const lockPath = path.join(mkdtempSync(path.join(tmpdir(), 'employed-lock-')), 'run.lock');
  acquireRunLock(lockPath, process.pid);

  assert.throws(() => acquireRunLock(lockPath, 4242), (error: unknown) => {
    assert.ok(error instanceof LockHeldError);
    assert.equal(error.holderPid, process.pid);
    return true;
  });
});

test('reclaims a stale lock left by a pid that is no longer running', () => {
  const lockPath = path.join(mkdtempSync(path.join(tmpdir(), 'employed-lock-')), 'run.lock');
  // Pid 999999 is astronomically unlikely to be alive in any test environment.
  writeFileSync(lockPath, '999999', 'utf8');

  const lock = acquireRunLock(lockPath, process.pid);
  assert.equal(readFileSync(lockPath, 'utf8'), String(process.pid));
  lock.release();
});

test('release is idempotent when called after the file is already gone', () => {
  const lockPath = path.join(mkdtempSync(path.join(tmpdir(), 'employed-lock-')), 'run.lock');
  const lock = acquireRunLock(lockPath, process.pid);
  lock.release();
  assert.doesNotThrow(() => lock.release());
});
