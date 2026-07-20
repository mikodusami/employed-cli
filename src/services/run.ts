/** Orchestration spine tying scraping, healing, lifecycle sweep, and reporting into one run. */
import type { AiRunner } from '../ai/types.js';
import type { AppConfig, KeywordsFile } from '../config/schema.js';
import type { CompanyRow, Repositories, ScrapeMethod, Tier } from '../db/index.js';
import { AiTailClassifier } from '../gmail/ai-classify.js';
import { EmailFetcher } from '../gmail/fetch.js';
import { buildDailyReport } from '../report/build.js';
import type { AutoAppliedUpdate, RunStats } from '../report/model.js';
import { writeReport } from '../report/writer.js';
import type { AtsDetector } from '../scrape/detect.js';
import type { HttpClient } from '../util/http.js';
import { ApplicationService } from './application.js';
import { EmailService } from './email.js';
import { ScrapeRuntime } from './scrape-runtime.js';
import type { ProposalPrompter } from './sync.js';
import { SyncService } from './sync.js';

/** Cron sync never prompts — nothing in `RunService` should ever call this. */
const NEVER_PROMPTER: ProposalPrompter = {
  selectProposals: () => Promise.resolve([]),
};

/** Kept short: `run` fires daily, so a small trailing window still covers any missed day. */
const GMAIL_SYNC_DAYS = 2;

/** One company's scrape failure surfaced through `runs.failures` and the report. */
export interface RunFailure {
  company: string;
  method: ScrapeMethod;
  reason: string;
}

/** Everything the `run` command needs to render its terminal digest. */
export interface RunSummary {
  runId: number;
  startedAt: string;
  finishedAt: string;
  companiesScanned: number;
  jobsSeen: number;
  jobsNew: number;
  jobsClosed: number;
  healed: number;
  broken: number;
  aiCalls: number;
  failures: readonly RunFailure[];
  reportPath: string;
  email: { attempted: boolean; sent: boolean; error: string | null };
}

/** `--tier` bypasses the schedule entirely; omitted, the tier scheduler picks the run's set. */
export interface RunOptions {
  tiers?: readonly Tier[];
  email?: boolean;
}

interface DigestSender {
  sendDigest(report: ReturnType<typeof buildDailyReport>): Promise<void>;
}

export interface RunServiceDependencies {
  repositories: Repositories;
  http: HttpClient;
  detector: AtsDetector;
  ai: AiRunner | null;
  config: AppConfig;
  keywords: KeywordsFile;
  now?: () => Date;
  /** Overrides the default `~/.employed/reports` destination; tests point this at a temp dir. */
  reportsDirectory?: string;
  /** Overrides the constructed cron `SyncService`; tests inject a fake instead of real AI/Gmail. */
  syncService?: SyncService;
  /** Overrides SMTP delivery; tests use an in-memory transport. */
  emailService?: DigestSender;
}

/** Mutable counters threaded through the per-company loop. */
interface RunAccumulator {
  companiesScanned: number;
  jobsSeen: number;
  jobsNew: number;
  jobsClosed: number;
  healed: number;
  failures: RunFailure[];
}

/** The single idempotent entry point the scheduler fires every morning. */
export class RunService {
  private readonly now: () => Date;

  public constructor(private readonly dependencies: RunServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public async execute(options: RunOptions = {}): Promise<RunSummary> {
    const { repositories } = this.dependencies;
    const startedAtDate = this.now();
    const startedAt = startedAtDate.toISOString();
    const run = repositories.runs.start(startedAt);
    const runtime = new ScrapeRuntime({
      repositories,
      http: this.dependencies.http,
      detector: this.dependencies.detector,
      ai: this.dependencies.ai,
      config: this.dependencies.config,
      keywords: this.dependencies.keywords,
    });

    const accumulator: RunAccumulator = {
      companiesScanned: 0,
      jobsSeen: 0,
      jobsNew: 0,
      jobsClosed: 0,
      healed: 0,
      failures: [],
    };
    let reportPath: string | null = null;
    let finishedAt = '';
    let brokenCount = 0;
    let aiCalls = 0;
    const email = { attempted: false, sent: false, error: null as string | null };

    try {
      const runIndex = repositories.runs.count();
      const allCompanies = repositories.companies.list();
      const selected =
        options.tiers && options.tiers.length > 0
          ? filterByTiers(allCompanies, options.tiers)
          : selectCompaniesForRun(allCompanies, runIndex);

      for (const company of selected) {
        await this.scanOneCompany(runtime, repositories, company, accumulator);
      }

      const autoApplied = await this.syncGmail(repositories);

      brokenCount = countBroken(repositories);
      aiCalls = this.dependencies.ai?.callCount?.() ?? 0;
      const runStats: RunStats = {
        companiesScanned: accumulator.companiesScanned,
        jobsSeen: accumulator.jobsSeen,
        jobsNew: accumulator.jobsNew,
        failures: accumulator.failures.length,
        healed: accumulator.healed,
        broken: brokenCount,
      };
      const date = startedAtDate.toISOString().slice(0, 10);
      const report = buildDailyReport(date, {
        repositories,
        now: startedAtDate,
        runStats,
        autoApplied,
      });
      reportPath = writeReport(report, this.dependencies.reportsDirectory);
      if (this.dependencies.config.email.enabled || options.email) {
        email.attempted = true;
        try {
          const emailService =
            this.dependencies.emailService ?? new EmailService(this.dependencies.config.email);
          await emailService.sendDigest(report);
          email.sent = true;
        } catch (error: unknown) {
          email.error = error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      finishedAt = this.now().toISOString();
      repositories.runs.finish({
        id: run.id,
        finished_at: finishedAt,
        companies_scanned: accumulator.companiesScanned,
        jobs_seen: accumulator.jobsSeen,
        jobs_new: accumulator.jobsNew,
        failures: accumulator.failures.length > 0 ? JSON.stringify(accumulator.failures) : null,
        claude_calls: aiCalls,
      });
      await runtime.close();
    }

    if (reportPath === null) {
      throw new Error('Run completed without writing a report.');
    }

    return {
      runId: run.id,
      startedAt,
      finishedAt,
      companiesScanned: accumulator.companiesScanned,
      jobsSeen: accumulator.jobsSeen,
      jobsNew: accumulator.jobsNew,
      jobsClosed: accumulator.jobsClosed,
      healed: accumulator.healed,
      broken: brokenCount,
      aiCalls,
      failures: accumulator.failures,
      reportPath,
      email,
    };
  }

  /** One company's failure, expected or not, becomes a failure entry — never an aborted run. */
  private async scanOneCompany(
    runtime: ScrapeRuntime,
    repositories: Repositories,
    company: CompanyRow,
    accumulator: RunAccumulator,
  ): Promise<void> {
    accumulator.companiesScanned += 1;
    const previousSuccessAt = company.last_success;
    try {
      const result = await runtime.scraper.scrapeCompany(company);
      if (result.status === 'completed') {
        accumulator.jobsSeen += result.seen;
        accumulator.jobsNew += result.new;
        if (previousSuccessAt) {
          accumulator.jobsClosed += repositories.jobs.markClosedIfUnseen(
            company.id,
            previousSuccessAt,
          );
        }
      } else if (result.status === 'failed') {
        accumulator.failures.push({
          company: company.name,
          method: result.method,
          reason: result.reason ?? 'Unknown failure.',
        });
      }
      if (result.heal?.healed) {
        accumulator.healed += 1;
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      accumulator.failures.push({ company: company.name, method: company.scrape_method, reason });
    }
  }

  /**
   * Runs cron-mode Gmail sync when AI is available, returning any auto-applied updates for the
   * report. Any failure here (including Gmail MCP not yet being configured) degrades to a clean
   * no-op rather than aborting the run — the same "one part's failure never aborts the run"
   * discipline the scraping loop follows.
   */
  private async syncGmail(repositories: Repositories): Promise<readonly AutoAppliedUpdate[]> {
    const ai = this.dependencies.ai;
    if (!ai) {
      return [];
    }
    try {
      const sync =
        this.dependencies.syncService ??
        new SyncService(
          repositories,
          new ApplicationService(repositories, this.now),
          new EmailFetcher(ai),
          new AiTailClassifier(ai),
          ai,
          NEVER_PROMPTER,
          this.now,
        );
      const result = await sync.run('cron', { days: GMAIL_SYNC_DAYS });
      return result.autoApplied;
    } catch {
      return [];
    }
  }
}

/** Pure tier-schedule filter — the one piece of new logic here, so it is tested in isolation. */
export function selectCompaniesForRun(
  companies: readonly CompanyRow[],
  runIndex: number,
): readonly CompanyRow[] {
  return companies.filter((company) => isScheduledThisRun(company, runIndex));
}

function isScheduledThisRun(company: CompanyRow, runIndex: number): boolean {
  if (company.tier === 'A') {
    return true;
  }
  if (company.tier === 'B') {
    return company.scrape_method === 'generated-playwright' ? runIndex % 2 === 0 : true;
  }
  return runIndex % 3 === 0;
}

function filterByTiers(
  companies: readonly CompanyRow[],
  tiers: readonly Tier[],
): readonly CompanyRow[] {
  const allowed = new Set(tiers);
  return companies.filter((company) => allowed.has(company.tier));
}

function countBroken(repositories: Repositories): number {
  return repositories.companies.list().filter((company) => company.health === 'broken').length;
}
