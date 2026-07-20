/** Safe argv-only subprocess execution with bounded output and hard timeout escalation. */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const KILL_GRACE_MS = 250;

type SpawnProcess = (
  binary: string,
  args: readonly string[],
  options: { shell: false; stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcessByStdio<null, Readable, Readable>;

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
  public constructor(
    private readonly spawnProcess: SpawnProcess = (binary, args, options) =>
      spawn(binary, [...args], options),
    private readonly killGraceMs = KILL_GRACE_MS,
  ) {}

  public run(request: ProcessRequest): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      // SECURITY: argv is always passed as an array and shell execution is never enabled.
      const child = this.spawnProcess(request.binary, request.args, {
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
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.killGraceMs);
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
