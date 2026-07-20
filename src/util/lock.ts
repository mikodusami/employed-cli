/** Pidfile guarding a manual and scheduled `employed run` from colliding. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { AppError } from './errors.js';

/** Thrown when another `employed run` currently holds the lock. */
export class LockHeldError extends AppError {
  public constructor(public readonly holderPid: number) {
    super(`employed run is already in progress (pid ${holderPid}).`);
  }
}

/** A held lock; release exactly once, normally from a `finally`. */
export interface RunLock {
  release(): void;
}

/** Probes whether a pid is still alive without sending it a real signal. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code =
      error instanceof Error && 'code' in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    return code !== 'ESRCH';
  }
}

/** Acquires the run lock, reclaiming it automatically when the owning pid is dead. */
export function acquireRunLock(lockPath: string, pid: number = process.pid): RunLock {
  if (existsSync(lockPath)) {
    const holderPid = readHolderPid(lockPath);
    if (holderPid !== null && isProcessAlive(holderPid)) {
      throw new LockHeldError(holderPid);
    }
  }
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, String(pid), 'utf8');
  return {
    release: (): void => {
      if (existsSync(lockPath)) {
        rmSync(lockPath);
      }
    },
  };
}

function readHolderPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}
