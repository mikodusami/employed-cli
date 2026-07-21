/** Explicit capture → analyze → plan → execute → validate generation state machine. */
import { createHash } from 'node:crypto';

import { load } from 'cheerio';
import { z } from 'zod';

import { AiUnavailableError } from '../ai/errors.js';
import { renderTemplate } from '../ai/templates.js';
import type { AiRunner } from '../ai/types.js';
import { EMPLOYED_DIR } from '../constants.js';
import type { CompanyRow, Repositories, ScrapeMethod } from '../db/index.js';
import { analyzeCapture, type AnalysisPacket } from '../scrape/analyze.js';
import { BrowserPool } from '../scrape/browser.js';
import {
  capturePage,
  type CaptureDeadlines,
  type CaptureResult,
  type CaptureStrategy,
} from '../scrape/capture/index.js';
import {
  writeDiagnosticsBundle,
  type AttemptDiagnostic,
} from '../scrape/diagnostics.js';
import { ScraperPlanSchema, type ScraperPlan } from '../scrape/plan.js';
import { NO_STAGE_REPORTER, type StageReporter } from '../scrape/progress.js';
import { ApiExecutor, type ExecutionReport } from '../scrape/runtime/api.js';
import { DomExecutor } from '../scrape/runtime/dom.js';
import { validateExtraction } from '../scrape/validate.js';
import type { HttpClient } from '../util/http.js';

const TEMPLATE_ID = 'scraper_plan_v2';
const AI_TIMEOUT_MS = 120_000;
const MIN_JOB_LINKS = 3;

export type GenerateResult =
  | {
      status: 'generated';
      ok: true;
      jobCount: number;
      strategy: 'api' | 'static' | 'playwright';
      confidence: number;
    }
  | {
      status: 'failed';
      ok: false;
      reasons: readonly string[];
      pendingPlaywright: false;
      diagnosticsPath: string;
    }
  | {
      status: 'skipped';
      ok: false;
      reason: string;
    };

export interface GenerateOptions {
  evidenceFirst?: boolean;
}

export interface GenerateRuntimeOptions {
  deadlines?: CaptureDeadlines;
  maxAttempts?: number;
  diagnosticsDirectory?: string;
  report?: StageReporter;
}

/** Owns the rule that only successfully executed and validated plans are persisted. */
export class GenerateService {
  private readonly deadlines: CaptureDeadlines;
  private readonly maxAttempts: number;
  private readonly diagnosticsDirectory: string;
  private readonly report: StageReporter;

  public constructor(
    private readonly repositories: Repositories,
    private readonly http: HttpClient,
    private readonly ai: AiRunner | null,
    private readonly browsers?: BrowserPool,
    options: GenerateRuntimeOptions = {},
  ) {
    this.deadlines = options.deadlines ?? {
      staticDeadlineMs: 45_000,
      playwrightDeadlineMs: 90_000,
    };
    this.maxAttempts = options.maxAttempts ?? 4;
    this.diagnosticsDirectory = options.diagnosticsDirectory ?? EMPLOYED_DIR;
    this.report = options.report ?? NO_STAGE_REPORTER;
  }

  public async generateFor(
    company: CompanyRow,
    options: GenerateOptions = {},
  ): Promise<GenerateResult> {
    if (!this.ai) {
      return { status: 'skipped', ok: false, reason: 'AI unavailable.' };
    }

    const attempts: AttemptDiagnostic[] = [];
    let capture: CaptureResult | null = null;
    let analysis: AnalysisPacket | null = null;
    let feedback = 'None. This is the first plan attempt.';
    let attempt = options.evidenceFirst ? 3 : 1;
    let finalReasons: readonly string[] = ['No plan attempt completed.'];

    while (attempt <= this.maxAttempts) {
      const strategy = captureStrategy(attempt, Boolean(this.browsers));
      if (!capture || capture.strategy !== strategy) {
        try {
          this.report('capture', `capturing careers page (${strategy})`, {
            company: company.name,
            attempt,
            url: company.careers_url,
          });
          capture = await capturePage(
            strategy,
            company.careers_url,
            this.http,
            this.browsers,
            this.deadlines,
          );
          this.report('capture', 'capture completed', {
            strategy: capture.strategy,
            finalUrl: capture.finalUrl,
            networkEntries: capture.networkLog.length,
          });
          analysis = analyzeCapture(capture);
          this.report('analyze', 'evidence packet prepared', {
            linkPatterns: analysis.linkPatterns.length,
            navigationHops: analysis.navigationPath.length,
          });
        } catch (error: unknown) {
          finalReasons = [errorMessage(error)];
          this.report(
            'capture',
            'capture failed',
            { company: company.name, attempt, error: finalReasons[0] },
            'error',
          );
          attempts.push({ attempt, plan: null, errors: finalReasons });
          if (strategy === 'static' && this.browsers) {
            attempt = 3;
            continue;
          }
          break;
        }
      }

      if (
        attempt < 3 &&
        this.browsers &&
        countLikelyJobLinks(capture.html) < MIN_JOB_LINKS
      ) {
        this.report('capture', 'static page is sparse; escalating to browser network evidence', {
          company: company.name,
          attempt,
        });
        feedback = 'Static HTML was an empty shell; use rendered and network evidence.';
        attempt = 3;
        capture = null;
        analysis = null;
        continue;
      }

      if (!analysis) {
        finalReasons = ['Capture analysis was unavailable.'];
        break;
      }

      let plan: ScraperPlan;
      try {
        this.report('plan', `asking AI for plan (attempt ${attempt})`, {
          company: company.name,
          attempt,
        });
        plan = await this.ai.runJson({
          templateId: TEMPLATE_ID,
          input: buildPrompt(company, analysis, feedback),
          inputDigest: digest(JSON.stringify({ analysis, feedback })),
          schema: ScraperPlanSchema,
          timeoutMs: AI_TIMEOUT_MS,
        });
        this.report('plan', `received ${plan.mode} plan`, {
          company: company.name,
          attempt,
          confidence: plan.confidence,
        });
      } catch (error: unknown) {
        if (error instanceof AiUnavailableError) {
          return { status: 'skipped', ok: false, reason: 'AI unavailable.' };
        }
        finalReasons = [errorMessage(error)];
        this.report(
          'plan',
          'AI planning failed',
          { company: company.name, attempt, error: finalReasons[0] },
          'error',
        );
        attempts.push({ attempt, plan: null, errors: finalReasons });
        attempt += 1;
        continue;
      }

      this.report('execute', `executing ${plan.mode} plan`, {
        company: company.name,
        attempt,
      });
      const report = await executePlan(this.http, this.browsers, company, plan, this.deadlines);
      this.report('execute', 'plan execution completed', {
        company: company.name,
        requestCount: report.requestCount,
        pageCount: report.pageCount,
        jobs: report.postings.length,
      });
      const reasons = validateReport(report);
      attempts.push({ attempt, plan, errors: reasons });
      if (reasons.length === 0) {
        this.report('validate', 'extraction validation passed', {
          company: company.name,
          jobs: report.postings.length,
        });
        persistSuccess(this.repositories, company, plan, report.postings.length);
        return {
          status: 'generated',
          ok: true,
          jobCount: report.postings.length,
          strategy: plan.mode === 'api' ? 'api' : plan.strategy,
          confidence: plan.confidence,
        };
      }

      this.report(
        'validate',
        'extraction validation failed',
        { company: company.name, attempt, reasons },
        'warn',
      );
      finalReasons = reasons;
      feedback = JSON.stringify({ priorPlan: plan, validationErrors: reasons }, null, 2);
      attempt += 1;
    }

    const diagnosticsPath = writeDiagnosticsBundle(
      company.name,
      capture,
      analysis,
      attempts,
      this.diagnosticsDirectory,
    );
    this.report(
      'generate',
      'attempts exhausted; diagnostics bundle written',
      { company: company.name, diagnosticsPath },
      'error',
    );
    this.repositories.companies.updateHealth(company.id, 'manual-review');
    return {
      status: 'failed',
      ok: false,
      reasons: finalReasons,
      pendingPlaywright: false,
      diagnosticsPath,
    };
  }
}

async function executePlan(
  http: HttpClient,
  browsers: BrowserPool | undefined,
  company: CompanyRow,
  plan: ScraperPlan,
  deadlines: CaptureDeadlines,
): Promise<ExecutionReport> {
  if (plan.mode === 'api') {
    return new ApiExecutor(http, plan, deadlines.staticDeadlineMs).execute(company);
  }
  return new DomExecutor(http, browsers, plan).execute(company);
}

function validateReport(report: ExecutionReport): string[] {
  const reasons = [...report.errors];
  const verdict = validateExtraction(report.postings);
  if (!verdict.ok) {
    reasons.push(...verdict.reasons);
  }
  return [...new Set(reasons)];
}

function persistSuccess(
  repositories: Repositories,
  company: CompanyRow,
  plan: ScraperPlan,
  jobCount: number,
): void {
  const method: ScrapeMethod =
    plan.mode === 'api'
      ? 'generated-api'
      : plan.strategy === 'playwright'
        ? 'generated-playwright'
        : 'generated-static';
  repositories.withTransaction(() => {
    repositories.companies.updateMethod(company.id, method, null, JSON.stringify(plan));
    repositories.companies.recordSuccess(company.id, jobCount);
  });
}

function captureStrategy(attempt: number, browserAvailable: boolean): CaptureStrategy {
  return attempt < 3 || !browserAvailable ? 'static' : 'playwright-network';
}

function countLikelyJobLinks(html: string): number {
  const $ = load(html);
  return $('a[href]')
    .filter((_index, element) => {
      const link = $(element);
      return /job|career|position|opening|role|vacan/i.test(
        `${link.attr('href') ?? ''} ${link.text()}`,
      );
    })
    .length;
}

function buildPrompt(
  company: CompanyRow,
  analysis: AnalysisPacket,
  retryFeedback: string,
): string {
  return renderTemplate(TEMPLATE_ID, {
    company: company.name,
    url: company.careers_url,
    schema: JSON.stringify(z.toJSONSchema(ScraperPlanSchema), null, 2),
    retry_feedback: retryFeedback,
    navigation_path: JSON.stringify(analysis.navigationPath),
    link_patterns: JSON.stringify(analysis.linkPatterns, null, 2),
    network_summary: analysis.networkSummary,
    dom: analysis.distilledDom,
  });
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
