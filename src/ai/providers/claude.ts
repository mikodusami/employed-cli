/** Claude Code non-interactive provider adapter. */
import { z } from 'zod';

import { AiProviderError, ProviderUnavailableError } from '../errors.js';
import { NodeProcessRunner, type ProcessRunner } from '../process.js';
import type { AiProvider, AiRequest, ProviderStatus } from '../types.js';

const ClaudeEnvelopeSchema = z.object({ result: z.string() }).passthrough();
const VERSION_TIMEOUT_MS = 5_000;

export class ClaudeCodeProvider implements AiProvider {
  public readonly name = 'claude' as const;
  private status?: Promise<ProviderStatus>;

  public constructor(private readonly processes: ProcessRunner = new NodeProcessRunner()) {}

  public isAvailable(): Promise<ProviderStatus> {
    return (this.status ??= this.checkAvailability());
  }

  public async run(request: AiRequest): Promise<string> {
    const args = ['-p', request.prompt, '--output-format', 'json'];
    if (request.allowedTools && request.allowedTools.length > 0) {
      args.push('--allowedTools', request.allowedTools.join(','));
    }

    try {
      const result = await this.processes.run({
        binary: 'claude',
        args,
        timeoutMs: request.timeoutMs,
      });
      if (result.timedOut) {
        throw new AiProviderError('claude', `Claude timed out after ${request.timeoutMs}ms.`);
      }
      if (result.exitCode !== 0) {
        throw new AiProviderError(
          'claude',
          `Claude exited with code ${String(result.exitCode)}: ${result.stderr.trim()}`,
        );
      }
      const envelope = ClaudeEnvelopeSchema.safeParse(JSON.parse(result.stdout));
      if (!envelope.success) {
        throw new AiProviderError('claude', 'Claude returned an invalid JSON envelope.');
      }
      return envelope.data.result;
    } catch (error: unknown) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      if (isMissingBinary(error)) {
        throw new ProviderUnavailableError(
          'claude',
          'Claude Code is not installed. Install it and authenticate the `claude` CLI.',
          { cause: error },
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new AiProviderError('claude', `Claude failed: ${reason}`, { cause: error });
    }
  }

  private async checkAvailability(): Promise<ProviderStatus> {
    try {
      const result = await this.processes.run({
        binary: 'claude',
        args: ['--version'],
        timeoutMs: VERSION_TIMEOUT_MS,
      });
      const version = result.stdout.trim() || result.stderr.trim();
      return result.exitCode === 0 && !result.timedOut
        ? { available: true, version, detail: null }
        : { available: false, version: null, detail: version || 'version check failed' };
    } catch (error: unknown) {
      return {
        available: false,
        version: null,
        detail: isMissingBinary(error) ? 'binary not found on PATH' : String(error),
      };
    }
  }
}

function isMissingBinary(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
