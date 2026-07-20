/** Provider-neutral contracts consumed by every future AI-backed feature. */
import type { ZodType } from 'zod';

import type { ProviderName } from '../config/schema.js';

export interface ProviderStatus {
  available: boolean;
  version: string | null;
  detail: string | null;
}

export interface AiRequest {
  prompt: string;
  timeoutMs: number;
  allowedTools?: readonly string[];
}

export interface AiProvider {
  readonly name: ProviderName;
  isAvailable(): Promise<ProviderStatus>;
  run(request: AiRequest): Promise<string>;
}

export interface AiTask<Result> {
  templateId: string;
  input: string;
  inputDigest: string;
  schema: ZodType<Result>;
  timeoutMs: number;
  allowedTools?: readonly string[];
}

/** The only AI surface available to feature modules. */
export interface AiRunner {
  runJson<Result>(task: AiTask<Result>): Promise<Result>;
}
