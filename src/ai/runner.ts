/** Provider fallback, budget, cache, extraction, validation, and correction discipline. */
import { createHash } from 'node:crypto';

import type { ZodType } from 'zod';

import type { AiConfig } from '../config/schema.js';
import type { Repositories } from '../db/index.js';
import {
  AiBudgetExceededError,
  AiProviderError,
  AiUnavailableError,
  AiValidationError,
} from './errors.js';
import { extractJsonBlock } from './extract.js';
import type { AiProvider, AiRequest, AiRunner, AiTask } from './types.js';

type TimeoutGuard = (
  provider: AiProvider,
  request: AiRequest,
) => Promise<string>;

interface ParseResult<Result> {
  success: boolean;
  value?: Result;
  issues: string;
}

export class DefaultAiRunner implements AiRunner {
  private calls = 0;

  public constructor(
    private readonly providers: readonly AiProvider[],
    private readonly repositories: Repositories,
    private readonly config: AiConfig,
    private readonly debug: (message: string) => void = () => undefined,
    private readonly guard: TimeoutGuard = runWithTimeout,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async runJson<Result>(task: AiTask<Result>): Promise<Result> {
    const failures: string[] = [];
    for (const provider of this.providers) {
      const cacheKey = buildCacheKey(provider.name, task.templateId, task.inputDigest);
      const cached = this.repositories.aiCache.find(cacheKey);
      if (cached) {
        const parsed = parseResponse(cached.response, task.schema);
        if (parsed.success) {
          return parsed.value as Result;
        }
        this.debug(`Ignoring invalid AI cache entry for ${provider.name}: ${parsed.issues}`);
      }

      const status = await provider.isAvailable();
      if (!status.available) {
        failures.push(`${provider.name}: ${status.detail ?? 'unavailable'}`);
        continue;
      }

      try {
        const value = await this.runAndValidate(provider, task);
        this.repositories.aiCache.upsert(
          cacheKey,
          JSON.stringify(value),
          this.now().toISOString(),
        );
        return value;
      } catch (error: unknown) {
        if (error instanceof AiValidationError || error instanceof AiBudgetExceededError) {
          throw error;
        }
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${provider.name}: ${reason}`);
        this.debug(`AI provider fallback after ${provider.name}: ${reason}`);
      }
    }
    throw new AiUnavailableError(
      `No configured AI provider completed the task.${failures.length ? ` ${failures.join('; ')}` : ''}`,
    );
  }

  private async runAndValidate<Result>(
    provider: AiProvider,
    task: AiTask<Result>,
  ): Promise<Result> {
    const first = await this.invoke(provider, {
      prompt: task.input,
      timeoutMs: task.timeoutMs,
      allowedTools: task.allowedTools,
    });
    const firstParsed = parseResponse(first, task.schema);
    if (firstParsed.success) {
      return firstParsed.value as Result;
    }

    const correctionPrompt =
      `${task.input}\n\nYour previous response failed validation:\n${firstParsed.issues}` +
      '\nRespond with ONLY corrected JSON.';
    const second = await this.invoke(provider, {
      prompt: correctionPrompt,
      timeoutMs: task.timeoutMs,
      allowedTools: task.allowedTools,
    });
    const secondParsed = parseResponse(second, task.schema);
    if (secondParsed.success) {
      return secondParsed.value as Result;
    }
    throw new AiValidationError(
      `AI response failed validation twice: ${secondParsed.issues}`,
      [first, second],
    );
  }

  private invoke(provider: AiProvider, request: AiRequest): Promise<string> {
    if (this.calls >= this.config.maxCallsPerRun) {
      throw new AiBudgetExceededError(
        `AI call budget exhausted (${this.config.maxCallsPerRun} per run).`,
      );
    }
    this.calls += 1;
    return this.guard(provider, request);
  }
}

export function buildCacheKey(
  provider: string,
  templateId: string,
  inputDigest: string,
): string {
  return createHash('sha256').update(provider + templateId + inputDigest).digest('hex');
}

function parseResponse<Result>(raw: string, schema: ZodType<Result>): ParseResult<Result> {
  const json = extractJsonBlock(raw);
  if (!json) {
    return { success: false, issues: 'No complete JSON object or array was found.' };
  }
  try {
    const parsedJson: unknown = JSON.parse(json);
    const parsed = schema.safeParse(parsedJson);
    if (parsed.success) {
      return { success: true, value: parsed.data, issues: '' };
    }
    return {
      success: false,
      issues: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('\n'),
    };
  } catch (error: unknown) {
    return {
      success: false,
      issues: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runWithTimeout(provider: AiProvider, request: AiRequest): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      provider.run(request),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AiProviderError(
                provider.name,
                `${provider.name} exceeded runner timeout ${request.timeoutMs}ms.`,
              ),
            ),
          request.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
