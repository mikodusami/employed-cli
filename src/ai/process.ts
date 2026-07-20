/** Safe argv-only subprocess execution with bounded output and hard timeout escalation. */
import { spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const KILL_GRACE_MS = 250;

export interface ProcessRequest {
  binary: string;
  args: readonly string[];
  timeoutMs: number;
}

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}

/** Runs a child without a shell, preventing prompt or argument interpolation. */
export class NodeProcessRunner implements ProcessRunner {
  public run(request: ProcessRequest): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      // SECURITY: argv is always passed as an array and shell execution is never enabled.
      const child = spawn(request.binary, [...request.args], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      }, request.timeoutMs);

      const append = (current: string, chunk: Buffer): string => {
        const next = current + chunk.toString('utf8');
        if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
          child.kill('SIGKILL');
          throw new Error(`AI provider output exceeded ${MAX_OUTPUT_BYTES} bytes.`);
        }
        return next;
      };

      child.stdout.on('data', (chunk: Buffer) => {
        try {
          stdout = append(stdout, chunk);
        } catch (error: unknown) {
          rejectOnce(error);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        try {
          stderr = append(stderr, chunk);
        } catch (error: unknown) {
          rejectOnce(error);
        }
      });
      child.on('error', rejectOnce);
      child.on('close', (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (killTimer) {
          clearTimeout(killTimer);
        }
        resolve({ exitCode, stdout, stderr, timedOut });
      });

      function rejectOnce(error: unknown): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (killTimer) {
          clearTimeout(killTimer);
        }
        child.kill('SIGKILL');
        reject(error);
      }
    });
  }
}
