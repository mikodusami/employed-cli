/** Orchestrates distillation, AI generation, execution, validation, retry, and persistence. */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { AiUnavailableError } from '../ai/errors.js';
import { renderTemplate } from '../ai/templates.js';
import type { AiRunner } from '../ai/types.js';
import type { CompanyRow, Repositories } from '../db/index.js';
import { ScraperConfigSchema, type ScraperConfig } from '../scrape/config.js';
import { distillDom } from '../scrape/distill.js';
import { GeneratedSource } from '../scrape/generated.js';
import { validateExtraction, type ValidationVerdict } from '../scrape/validate.js';
import { RequiresRenderError } from '../util/errors.js';
import type { HttpClient } from '../util/http.js';

const TEMPLATE_ID = 'scraper_gen_v1';
const AI_TIMEOUT_MS = 120_000;

export type GenerateResult =
  | {
      status: 'generated';
      ok: true;
      jobCount: number;
      strategy: ScraperConfig['strategy'];
      confidence: number;
    }
  | {
      status: 'failed';
      ok: false;
      reasons: readonly string[];
      pendingPlaywright: boolean;
    }
  | {
      status: 'skipped';
      ok: false;
      reason: string;
    };

/** Owns the hard rule that generated configurations are persisted only after execution. */
export class GenerateService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly http: HttpClient,
    private readonly ai: AiRunner | null,
  ) {}

  public async generateFor(company: CompanyRow): Promise<GenerateResult> {
    if (!this.ai) {
      return { status: 'skipped', ok: false, reason: 'AI unavailable.' };
    }

    const response = await this.http.fetchText(company.careers_url);
    if (response.status < 200 || response.status >= 300) {
      return {
        status: 'failed',
        ok: false,
        reasons: [`Careers page returned HTTP ${response.status}.`],
        pendingPlaywright: false,
      };
    }
    const distilled = distillDom(response.body);
    const baseDigest = digest(distilled.dom);
    let feedback = '';
    let finalReasons: readonly string[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let config: ScraperConfig;
      try {
        config = await this.ai.runJson({
          templateId: TEMPLATE_ID,
          input: buildPrompt(company, distilled.dom, distilled.linkDensityHint, feedback),
          inputDigest: attempt === 0 ? baseDigest : digest(`${baseDigest}\n${feedback}`),
          schema: ScraperConfigSchema,
          timeoutMs: AI_TIMEOUT_MS,
        });
      } catch (error: unknown) {
        if (error instanceof AiUnavailableError) {
          return { status: 'skipped', ok: false, reason: 'AI unavailable.' };
        }
        throw error;
      }
      const execution = await executeAndValidate(this.http, company, config);
      if (execution.requiresRender) {
        const pendingConfig = { ...config, strategy: 'playwright' as const };
        this.repositories.companies.updateMethod(
          company.id,
          'generated-playwright',
          null,
          JSON.stringify(pendingConfig),
        );
        return {
          status: 'failed',
          ok: false,
          reasons: ['Generated configuration requires browser rendering.'],
          pendingPlaywright: true,
        };
      }
      if (execution.verdict.ok) {
        this.repositories.withTransaction(() => {
          this.repositories.companies.updateMethod(
            company.id,
            'generated-static',
            null,
            JSON.stringify(config),
          );
          this.repositories.companies.recordSuccess(company.id, execution.jobCount);
        });
        return {
          status: 'generated',
          ok: true,
          jobCount: execution.jobCount,
          strategy: config.strategy,
          confidence: config.confidence,
        };
      }
      finalReasons = execution.verdict.reasons;
      feedback = finalReasons.join('\n');
    }

    this.repositories.companies.updateHealth(company.id, 'broken');
    return { status: 'failed', ok: false, reasons: finalReasons, pendingPlaywright: false };
  }
}

interface ExecutionResult {
  verdict: ValidationVerdict;
  jobCount: number;
  requiresRender: boolean;
}

async function executeAndValidate(
  http: HttpClient,
  company: CompanyRow,
  config: ScraperConfig,
): Promise<ExecutionResult> {
  try {
    const postings = await new GeneratedSource(http, config).fetchPostings(company);
    return {
      verdict: validateExtraction(postings),
      jobCount: postings.length,
      requiresRender: false,
    };
  } catch (error: unknown) {
    if (error instanceof RequiresRenderError) {
      return {
        verdict: { ok: false, reasons: [error.message] },
        jobCount: 0,
        requiresRender: true,
      };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return {
      verdict: { ok: false, reasons: [`Generated scraper execution failed: ${reason}`] },
      jobCount: 0,
      requiresRender: false,
    };
  }
}

function buildPrompt(
  company: CompanyRow,
  dom: string,
  linkDensityHint: string,
  retryFeedback: string,
): string {
  return renderTemplate(TEMPLATE_ID, {
    company: company.name,
    url: company.careers_url,
    schema: JSON.stringify(z.toJSONSchema(ScraperConfigSchema), null, 2),
    retry_feedback: retryFeedback || 'None. This is the first domain-validation attempt.',
    dom: `${linkDensityHint}\n${dom}`,
  });
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
