/** Orchestrates distillation, AI generation, execution, validation, retry, and persistence. */
import { createHash } from 'node:crypto';

import { load } from 'cheerio';
import { z } from 'zod';
import type { Page } from 'playwright';

import { AiUnavailableError } from '../ai/errors.js';
import { renderTemplate } from '../ai/templates.js';
import type { AiRunner } from '../ai/types.js';
import type { CompanyRow, Repositories } from '../db/index.js';
import { BrowserPool } from '../scrape/browser.js';
import { ScraperConfigSchema, type ScraperConfig } from '../scrape/config.js';
import { distillDom } from '../scrape/distill.js';
import { GeneratedSource, PlaywrightGeneratedSource } from '../scrape/generated.js';
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
    private readonly browsers?: BrowserPool,
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
    let generationHtml = response.body;
    let preferBrowser = false;
    if (countLikelyJobLinks(response.body) < 3 && this.browsers) {
      generationHtml = await this.browsers.page((page) =>
        captureRenderedHtml(page, response.finalUrl),
      );
      preferBrowser = true;
    }
    const distilled = distillDom(generationHtml);
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
      const execution = await executeAndValidate(
        this.http,
        this.browsers,
        company,
        config,
        preferBrowser,
      );
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
          const persistedConfig = { ...config, strategy: execution.strategy };
          this.repositories.companies.updateMethod(
            company.id,
            execution.strategy === 'playwright'
              ? 'generated-playwright'
              : 'generated-static',
            null,
            JSON.stringify(persistedConfig),
          );
          this.repositories.companies.recordSuccess(company.id, execution.jobCount);
        });
        return {
          status: 'generated',
          ok: true,
          jobCount: execution.jobCount,
          strategy: execution.strategy,
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
  strategy: ScraperConfig['strategy'];
}

async function executeAndValidate(
  http: HttpClient,
  browsers: BrowserPool | undefined,
  company: CompanyRow,
  config: ScraperConfig,
  preferBrowser: boolean,
): Promise<ExecutionResult> {
  try {
    const useBrowser = preferBrowser || config.strategy === 'playwright';
    if (useBrowser && !browsers) {
      return renderRequired();
    }
    let postings;
    if (useBrowser) {
      if (!browsers) {
        return renderRequired();
      }
      postings = await new PlaywrightGeneratedSource(browsers, config).fetchPostings(company);
    } else {
      postings = await new GeneratedSource(http, config).fetchPostings(company);
    }
    return {
      verdict: validateExtraction(postings),
      jobCount: postings.length,
      requiresRender: false,
      strategy: useBrowser ? 'playwright' : 'static',
    };
  } catch (error: unknown) {
    if (error instanceof RequiresRenderError) {
      if (browsers) {
        const postings = await new PlaywrightGeneratedSource(browsers, config).fetchPostings(
          company,
        );
        return {
          verdict: validateExtraction(postings),
          jobCount: postings.length,
          requiresRender: false,
          strategy: 'playwright',
        };
      }
      return renderRequired();
    }
    const reason = error instanceof Error ? error.message : String(error);
    return {
      verdict: { ok: false, reasons: [`Generated scraper execution failed: ${reason}`] },
      jobCount: 0,
      requiresRender: false,
      strategy: preferBrowser ? 'playwright' : 'static',
    };
  }
}

function renderRequired(): ExecutionResult {
  return {
    verdict: { ok: false, reasons: ['Generated scraper requires browser rendering.'] },
    jobCount: 0,
    requiresRender: true,
    strategy: 'playwright',
  };
}

function countLikelyJobLinks(html: string): number {
  const $ = load(html);
  return $('a[href]')
    .filter((_index, element) => {
      const link = $(element);
      const signal = `${link.attr('href') ?? ''} ${link.text()}`;
      return /job|career|position|opening|role|vacan/i.test(signal);
    })
    .length;
}

async function captureRenderedHtml(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'networkidle' });
  return page.content();
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
