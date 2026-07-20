/** Deterministic database projection into the renderer-neutral report model. */
import type { Band, Repositories, RunRow } from '../db/index.js';
import type { DailyReport, ReportJob, RunStats } from './model.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BANDS: readonly Band[] = ['A', 'B', 'C', 'D'];

export interface BuildReportDependencies {
  repositories: Repositories;
  now: Date;
}

export function buildDailyReport(
  date: string,
  dependencies: BuildReportDependencies,
): DailyReport {
  const companies = dependencies.repositories.companies.list();
  const companyNames = new Map(companies.map((company) => [company.id, company.name]));
  const newJobsByBand: DailyReport['newJobsByBand'] = { A: [], B: [], C: [], D: [] };
  for (const job of dependencies.repositories.jobs.listOpenFirstSeenOn(date)) {
    const band = job.band ?? 'D';
    newJobsByBand[band].push({
      score: job.score ?? 0,
      band,
      company: companyNames.get(job.company_id) ?? 'Unknown company',
      title: job.title,
      location: job.location,
      url: job.url,
      ageDays: ageInDays(job.first_seen, dependencies.now),
      titleOnly: !job.description?.trim(),
    });
  }
  for (const band of BANDS) {
    newJobsByBand[band].sort(compareJobs);
  }

  const brokenCompanies = companies.filter((company) => company.health === 'broken');
  return {
    date,
    runStats: toRunStats(dependencies.repositories.runs.latest(), brokenCompanies.length),
    newJobsByBand,
    autoApplied: [],
    needsAttention: brokenCompanies.map((company) => ({
      type: 'broken-scraper',
      company: company.name,
      message: `${company.name} scraper is broken and needs review.`,
    })),
  };
}

function compareJobs(left: ReportJob, right: ReportJob): number {
  return right.score - left.score || left.title.localeCompare(right.title);
}

function ageInDays(firstSeen: string, now: Date): number {
  const elapsed = now.getTime() - new Date(firstSeen).getTime();
  return Math.max(0, Math.floor(elapsed / DAY_MS));
}

function toRunStats(run: RunRow | undefined, broken: number): RunStats | null {
  if (!run) {
    return null;
  }
  return {
    companiesScanned: run.companies_scanned ?? 0,
    jobsSeen: run.jobs_seen ?? 0,
    jobsNew: run.jobs_new ?? 0,
    failures: failureCount(run.failures),
    healed: 0,
    broken,
  };
}

function failureCount(value: string | null): number {
  if (!value) {
    return 0;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 1;
  } catch {
    return 1;
  }
}
