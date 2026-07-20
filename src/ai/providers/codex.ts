/** OpenAI Codex non-interactive JSONL provider adapter. */
import { z } from 'zod';

import { AiProviderError, ProviderUnavailableError } from '../errors.js';
import { NodeProcessRunner, type ProcessRunner } from '../process.js';
import type { AiProvider, AiRequest, ProviderStatus } from '../types.js';

const AgentMessageEventSchema = z.object({
  type: z.literal('item.completed'),
  item: z.object({
    type: z.literal('agent_message'),
    text: z.string(),
  }),
});
const VERSION_TIMEOUT_MS = 5_000;

export class CodexProvider implements AiProvider {
  public readonly name = 'codex' as const;
  private status?: Promise<ProviderStatus>;

  public constructor(
    private readonly processes: ProcessRunner = new NodeProcessRunner(),
    private readonly debug: (message: string) => void = () => undefined,
  ) {}

  public isAvailable(): Promise<ProviderStatus> {
    return (this.status ??= this.checkAvailability());
  }

  public async run(request: AiRequest): Promise<string> {
    if (request.allowedTools && request.allowedTools.length > 0) {
      this.debug(
        `Codex tool grants are configured outside each call; requested: ${request.allowedTools.join(', ')}`,
      );
    }

    // Verified against current `codex exec --help`: JSONL, ephemeral, read-only, repo-check bypass.
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      request.prompt,
    ];
    try {
      const result = await this.processes.run({
        binary: 'codex',
        args,
        timeoutMs: request.timeoutMs,
      });
      if (result.timedOut) {
        throw new AiProviderError('codex', `Codex timed out after ${request.timeoutMs}ms.`);
      }
      if (result.exitCode !== 0) {
        throw new AiProviderError(
          'codex',
          `Codex exited with code ${String(result.exitCode)}: ${result.stderr.trim()}`,
        );
      }
      return extractFinalAgentMessage(result.stdout);
    } catch (error: unknown) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      if (isMissingBinary(error)) {
        throw new ProviderUnavailableError(
          'codex',
          'Codex CLI is not installed. Install it and authenticate the `codex` CLI.',
          { cause: error },
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new AiProviderError('codex', `Codex failed: ${reason}`, { cause: error });
    }
  }

  private async checkAvailability(): Promise<ProviderStatus> {
    try {
      const result = await this.processes.run({
        binary: 'codex',
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

export function extractFinalAgentMessage(jsonLines: string): string {
  let finalMessage: string | null = null;
  for (const line of jsonLines.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = AgentMessageEventSchema.safeParse(JSON.parse(line));
      if (event.success) {
        finalMessage = event.data.item.text;
      }
    } catch {
      // A malformed event cannot be the validated final agent-message envelope.
    }
  }
  if (!finalMessage) {
    throw new AiProviderError('codex', 'Codex JSONL contained no final agent message.');
  }
  return finalMessage;
}

function isMissingBinary(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
