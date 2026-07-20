/** Orchestrates source lookup, canonical job persistence, and scraper health outcomes. */
import type { CompanyRow, JobRow, Repositories, ScrapeMethod } from '../db/index.js';
import { getSource } from '../scrape/adapters/index.js';
import { toJobInput } from '../scrape/normalize.js';
import type { RawPosting } from '../scrape/types.js';
import type { HttpClient } from '../util/http.js';

/** Structured result of scraping one company. */
export interface CompanyScrapeResult {
  status: 'completed' | 'skipped' | 'failed';
  method: ScrapeMethod;
  seen: number;
  new: number;
  newJobs: readonly JobRow[];
  reason: string | null;
}

/** Structured result of checking whether an adapter yields usable postings. */
export interface SmokeResult {
  ok: boolean;
  method: ScrapeMethod;
  count: number;
  reason: string | null;
}

/** Contains per-company adapter failures so callers can continue processing. */
export class ScrapeService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly http: HttpClient,
  ) {}

  /** Fetches, normalizes, and atomically upserts all jobs for one company. */
  public async scrapeCompany(company: CompanyRow): Promise<CompanyScrapeResult> {
    const source = getSource(company.scrape_method, { http: this.http });
    if (!source) {
      return result('skipped', company.scrape_method, `No source for ${company.scrape_method}.`);
    }

    try {
      const postings = await source.fetchPostings(company);
      const today = new Date().toISOString();
      const newJobs = this.repositories.withTransaction(() => {
        const insertedJobs: JobRow[] = [];
        for (const posting of postings) {
          const upsert = this.repositories.jobs.upsert(toJobInput(posting, company.id, today));
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
      };
    } catch (error: unknown) {
      this.repositories.companies.recordFailure(company.id);
      const reason = error instanceof Error ? error.message : String(error);
      return result('failed', source.method, reason);
    }
  }

  /** Runs one adapter fetch and records health only when usable jobs are returned. */
  public async smokeTest(company: CompanyRow): Promise<SmokeResult> {
    const source = getSource(company.scrape_method, { http: this.http });
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
): CompanyScrapeResult {
  return { status, method, seen: 0, new: 0, newJobs: [], reason };
}

function smokeResult(
  ok: boolean,
  method: ScrapeMethod,
  count: number,
  reason: string | null,
): SmokeResult {
  return { ok, method, count, reason };
}
