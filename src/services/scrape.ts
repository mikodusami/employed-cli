/** Orchestrates source lookup, canonical job persistence, and scraper health outcomes. */
import type { KeywordsFile } from '../config/schema.js';
import type { CompanyRow, JobRow, Repositories, ScrapeMethod } from '../db/index.js';
import { scoreJob } from '../score/engine.js';
import { getSource } from '../scrape/adapters/index.js';
import type { BrowserPool } from '../scrape/browser.js';
import { toJobInput } from '../scrape/normalize.js';
import type { RawPosting } from '../scrape/types.js';
import type { HttpClient } from '../util/http.js';
import type { HealBudget, HealResult, HealService } from './heal.js';

/** Structured result of scraping one company. */
export interface CompanyScrapeResult {
  status: 'completed' | 'skipped' | 'failed';
  method: ScrapeMethod;
  seen: number;
  new: number;
  newJobs: readonly JobRow[];
  reason: string | null;
  heal: HealResult | null;
}

/** Structured result of checking whether an adapter yields usable postings. */
export interface SmokeResult {
  ok: boolean;
  method: ScrapeMethod;
  count: number;
  reason: string | null;
}

export interface ScrapeServiceOptions {
  browsers?: BrowserPool;
  keywords?: KeywordsFile;
  healing?: {
    service: HealService;
    budget: HealBudget;
  };
}

/** Contains per-company adapter failures so callers can continue processing. */
export class ScrapeService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly http: HttpClient,
    private readonly options: ScrapeServiceOptions = {},
  ) {}

  /** Fetches, normalizes, and atomically upserts all jobs for one company. */
  public async scrapeCompany(company: CompanyRow): Promise<CompanyScrapeResult> {
    return this.scrapeAttempt(company, true, null);
  }

  private async scrapeAttempt(
    company: CompanyRow,
    allowHeal: boolean,
    priorHeal: HealResult | null,
  ): Promise<CompanyScrapeResult> {
    const source = getSource(company.scrape_method, {
      http: this.http,
      browsers: this.options.browsers,
    });
    if (!source) {
      return result(
        'skipped',
        company.scrape_method,
        `No source for ${company.scrape_method}.`,
        priorHeal,
      );
    }

    try {
      const postings = await source.fetchPostings(company);
      if (postings.length === 0 && isHealEligible(company)) {
        return this.handleFailure(
          company,
          source.method,
          'Previously healthy scraper returned zero postings.',
          allowHeal,
        );
      }
      const today = new Date().toISOString();
      const newJobs = this.repositories.withTransaction(() => {
        const insertedJobs: JobRow[] = [];
        for (const posting of postings) {
          const input = toJobInput(posting, company.id, today);
          const scored = scoreJob(
            { title: input.title, description: input.description },
            this.options.keywords ?? EMPTY_KEYWORDS,
          );
          const upsert = this.repositories.jobs.upsert({
            ...input,
            score: scored.score,
            band: scored.band,
            matched_kw: JSON.stringify(scored.matchedKeywords),
          });
          if (upsert.isNew) {
            insertedJobs.push(upsert.job);
          }
        }
        this.repositories.companies.recordSuccess(company.id, postings.length);
        return insertedJobs;
      });
      return {
        status: 'completed',
        method: source.method,
        seen: postings.length,
        new: newJobs.length,
        newJobs,
        reason: null,
        heal: priorHeal,
      };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.handleFailure(company, source.method, reason, allowHeal);
    }
  }

  private async handleFailure(
    company: CompanyRow,
    method: ScrapeMethod,
    reason: string,
    allowHeal: boolean,
  ): Promise<CompanyScrapeResult> {
    const healing = this.options.healing;
    if (!allowHeal || !healing || !isHealEligible(company)) {
      this.repositories.companies.recordFailure(company.id);
      if (isHealEligible(company)) {
        this.repositories.companies.updateHealth(company.id, 'degraded');
      }
      return result('failed', method, reason, null);
    }

    try {
      const heal = await healing.service.heal(company, healing.budget);
      if (heal.healed) {
        const repaired = this.repositories.companies.findByName(company.name);
        if (repaired) {
          return this.scrapeAttempt(repaired, false, heal);
        }
      }
      return result('failed', method, `${reason} ${heal.note}`, heal);
    } catch (error: unknown) {
      const healReason = error instanceof Error ? error.message : String(error);
      this.repositories.companies.updateHealth(company.id, 'broken');
      return result('failed', method, `${reason} Heal failed: ${healReason}`, null);
    }
  }

  /** Runs one adapter fetch and records health only when usable jobs are returned. */
  public async smokeTest(company: CompanyRow): Promise<SmokeResult> {
    const source = getSource(company.scrape_method, {
      http: this.http,
      browsers: this.options.browsers,
    });
    if (!source) {
      const reason = `No source for ${company.scrape_method}.`;
      return smokeResult(false, company.scrape_method, 0, reason);
    }

    try {
      const postings = await source.fetchPostings(company);
      if (postings.length === 0) {
        return smokeResult(false, source.method, 0, 'Adapter returned no postings.');
      }
      const invalidPosting = postings.find((posting) => !isValidPosting(posting));
      if (invalidPosting) {
        const reason = 'Adapter returned an invalid posting.';
        return smokeResult(false, source.method, postings.length, reason);
      }
      this.repositories.companies.recordSuccess(company.id, postings.length);
      this.repositories.companies.updateHealth(company.id, 'ok');
      return smokeResult(true, source.method, postings.length, null);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return smokeResult(false, source.method, 0, reason);
    }
  }
}

const EMPTY_KEYWORDS: KeywordsFile = {
  title: {},
  description: {},
  negative: {},
};

function isValidPosting(posting: RawPosting): boolean {
  if (posting.title.trim().length === 0) {
    return false;
  }
  try {
    new URL(posting.url);
    return true;
  } catch {
    return false;
  }
}

function result(
  status: 'skipped' | 'failed',
  method: ScrapeMethod,
  reason: string,
  heal: HealResult | null,
): CompanyScrapeResult {
  return { status, method, seen: 0, new: 0, newJobs: [], reason, heal };
}

function isHealEligible(company: CompanyRow): boolean {
  return company.health === 'ok' || company.health === 'degraded';
}

function smokeResult(
  ok: boolean,
  method: ScrapeMethod,
  count: number,
  reason: string | null,
): SmokeResult {
  return { ok, method, count, reason };
}
