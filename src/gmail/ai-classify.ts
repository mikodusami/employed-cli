/**
 * AI classification for the low-confidence tail the rule classifier couldn't place.
 *
 * @remarks Rules first, AI second, always — this is only ever called with emails `classify()`
 * already gave up on. Unlike `EmailFetcher`, this task's result is cached: the same batch digest
 * (same emails) is stable and safe to replay.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { renderTemplate } from '../ai/templates.js';
import type { AiRunner } from '../ai/types.js';
import type { EmailMeta } from './types.js';

const TEMPLATE_ID = 'email_classify_v1';
const CLASSIFY_TIMEOUT_MS = 120_000;

export const AiClassificationResultSchema = z.object({
  id: z.string(),
  type: z.enum(['applied', 'oa', 'interview', 'offer', 'rejected', 'ignore']),
  company: z.string().nullable(),
  role: z.string().nullable(),
});

/** One AI-resolved classification, keyed back to the source email by `id` (its `threadId`). */
export type AiClassificationResult = z.infer<typeof AiClassificationResultSchema>;

const AiClassificationResultArraySchema = z.array(AiClassificationResultSchema);

interface BatchInputEmail {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
}

/** Batches the rule-classifier's fall-through emails to one cached AI call. */
export class AiTailClassifier {
  public constructor(private readonly ai: AiRunner) {}

  public async classify(
    lowConfidence: readonly EmailMeta[],
  ): Promise<readonly AiClassificationResult[]> {
    if (lowConfidence.length === 0) {
      return [];
    }

    const batch: readonly BatchInputEmail[] = lowConfidence.map((email) => ({
      id: email.threadId,
      sender: email.sender,
      subject: email.subject,
      snippet: email.snippet,
    }));
    const batchJson = JSON.stringify(batch, null, 2);

    return this.ai.runJson({
      templateId: TEMPLATE_ID,
      input: renderTemplate(TEMPLATE_ID, {
        emails: batchJson,
        schema: JSON.stringify(z.toJSONSchema(AiClassificationResultArraySchema), null, 2),
      }),
      inputDigest: digest(batchJson),
      schema: AiClassificationResultArraySchema,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
    });
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
