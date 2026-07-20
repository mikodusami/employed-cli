/**
 * Pure analytics assembler over the applications/events the CRM and sync have accumulated.
 *
 * @remarks Every "did X ever happen" metric here is an event-scan (see `stats-queries.ts`), not a
 * current-status read — `applications.status` is a lossy projection of "where things ended up";
 * the event log is the truth about what happened along the way. Read-only: this module never
 * writes. Zero AI, zero network — a pure computation over what's already stored.
 */
import type Database from 'better-sqlite3';

import type { StatsConfig } from '../config/schema.js';
import type { Band } from '../db/index.js';
import type {
  BandOutcomeRow,
  KeywordCorrelationRow,
  NudgeItem,
  ResumeOutcomeRow,
  Sparkline,
  StatsReport,
} from '../report/stats-model.js';
import { sparkline } from '../util/sparkline.js';
import { listApplicationOutcomes, type ApplicationOutcomeRow } from './stats-queries.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SPARKLINE_WEEKS = 12;
const BANDS: readonly Band[] = ['A', 'B', 'C', 'D'];

/** Applications in these statuses are excluded from follow-up nudges and stale flags. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['offer', 'rejected']);

export class StatsService {
  public constructor(
    private readonly db: Database.Database,
    private readonly config: StatsConfig,
  ) {}

  public compute(now: Date): StatsReport {
    const rows = listApplicationOutcomes(this.db);
    const total = rows.length;
    const respondedCount = countWhere(rows, (row) => row.responded === 1);
    const positiveRespondedCount = countWhere(rows, (row) => row.positiveResponded === 1);
    const interviewedCount = countWhere(rows, (row) => row.interviewed === 1);
    const { outcomesByBand, excludedFromBandTable } = bandOutcomes(rows);
    const { nudges, stale } = nudgesAndStale(rows, now, this.config);

    return {
      totalApplications: total,
      responseRate: rate(respondedCount, total),
      positiveResponseRate: rate(positiveRespondedCount, total),
      interviewRate: rate(interviewedCount, total),
      avgDaysToFirstResponse: averageDaysToFirstResponse(rows),
      sparkline: buildSparkline(rows, now),
      outcomesByBand,
      excludedFromBandTable,
      outcomesByResume: resumeOutcomes(rows, this.config.minResumeSample),
      keywordCorrelation: keywordCorrelation(rows, this.config.minKeywordSample),
      nudges,
      stale,
    };
  }
}

function countWhere<T>(rows: readonly T[], predicate: (row: T) => boolean): number {
  return rows.reduce((count, row) => (predicate(row) ? count + 1 : count), 0);
}

/** Guards every division: an empty or all-zero denominator renders `null`, never `NaN`. */
function rate(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

/** Direct read of `first_response_at`/`applied_at` — both stamped once by `transition`, so this
 * needs no event-diff of its own (see decisions.md for the independent cross-check in tests). */
function averageDaysToFirstResponse(rows: readonly ApplicationOutcomeRow[]): number | null {
  const diffs = rows
    .filter((row): row is ApplicationOutcomeRow & { appliedAt: string; firstResponseAt: string } =>
      Boolean(row.appliedAt && row.firstResponseAt),
    )
    .map((row) => daysBetween(row.appliedAt, row.firstResponseAt));
  if (diffs.length === 0) {
    return null;
  }
  return diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
}

function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY_MS;
}

/** 12 weekly buckets ending "now", oldest to newest; out-of-window applications are dropped. */
function buildSparkline(rows: readonly ApplicationOutcomeRow[], now: Date): Sparkline {
  const counts = new Array<number>(SPARKLINE_WEEKS).fill(0);
  const nowMs = now.getTime();
  const windowStart = nowMs - SPARKLINE_WEEKS * WEEK_MS;
  for (const row of rows) {
    const time = new Date(row.appliedAt ?? row.createdAt).getTime();
    if (time < windowStart || time > nowMs) {
      continue;
    }
    const bucket = Math.min(SPARKLINE_WEEKS - 1, Math.floor((time - windowStart) / WEEK_MS));
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return { weeklyCounts: counts, chart: sparkline(counts) };
}

/** Manual/Gmail-origin applications (no linked job, or a job with no band) are excluded here. */
function bandOutcomes(rows: readonly ApplicationOutcomeRow[]): {
  outcomesByBand: BandOutcomeRow[];
  excludedFromBandTable: number;
} {
  const linked = rows.filter((row) => row.jobId !== null && row.band !== null);
  const outcomesByBand = BANDS.map((band) => {
    const bandRows = linked.filter((row) => row.band === band);
    const responded = countWhere(bandRows, (row) => row.responded === 1);
    const interviewed = countWhere(bandRows, (row) => row.interviewed === 1);
    return {
      band,
      total: bandRows.length,
      responseRate: rate(responded, bandRows.length),
      interviewRate: rate(interviewed, bandRows.length),
    };
  });
  return { outcomesByBand, excludedFromBandTable: rows.length - linked.length };
}

/** Low-sample groups (below `minSample`) are flagged, not hidden, per the spec. */
function resumeOutcomes(
  rows: readonly ApplicationOutcomeRow[],
  minSample: number,
): ResumeOutcomeRow[] {
  const byVersion = new Map<string, ApplicationOutcomeRow[]>();
  for (const row of rows) {
    if (!row.resumeVersion) {
      continue;
    }
    const group = byVersion.get(row.resumeVersion) ?? [];
    group.push(row);
    byVersion.set(row.resumeVersion, group);
  }
  return [...byVersion.entries()]
    .map(([resumeVersion, group]) => {
      const responded = countWhere(group, (row) => row.responded === 1);
      const interviewed = countWhere(group, (row) => row.interviewed === 1);
      return {
        resumeVersion,
        total: group.length,
        responseRate: rate(responded, group.length),
        interviewRate: rate(interviewed, group.length),
        lowSignal: group.length < minSample,
      };
    })
    .sort((left, right) => left.resumeVersion.localeCompare(right.resumeVersion));
}

/** A keyword below `minSample` linked applications is dropped entirely — noise, per the spec. */
function keywordCorrelation(
  rows: readonly ApplicationOutcomeRow[],
  minSample: number,
): KeywordCorrelationRow[] {
  const counts = new Map<string, { total: number; responded: number }>();
  for (const row of rows) {
    if (row.jobId === null || !row.matchedKw) {
      continue;
    }
    const keywords = parseKeywords(row.matchedKw);
    for (const keyword of keywords) {
      const entry = counts.get(keyword) ?? { total: 0, responded: 0 };
      entry.total += 1;
      if (row.responded === 1) {
        entry.responded += 1;
      }
      counts.set(keyword, entry);
    }
  }
  return [...counts.entries()]
    .filter(([, entry]) => entry.total >= minSample)
    .map(([keyword, entry]) => ({
      keyword,
      total: entry.total,
      responseRate: entry.responded / entry.total,
    }))
    .sort(
      (left, right) =>
        right.responseRate - left.responseRate || left.keyword.localeCompare(right.keyword),
    );
}

function parseKeywords(matchedKw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(matchedKw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

/** Quiet time is measured from `last_activity_at`, falling back to `created_at` if never set. */
function nudgesAndStale(
  rows: readonly ApplicationOutcomeRow[],
  now: Date,
  config: StatsConfig,
): { nudges: NudgeItem[]; stale: NudgeItem[] } {
  const nudges: NudgeItem[] = [];
  const stale: NudgeItem[] = [];
  for (const row of rows) {
    if (TERMINAL_STATUSES.has(row.status)) {
      continue;
    }
    const lastActivity = row.lastActivityAt ?? row.createdAt;
    const daysQuiet = Math.floor((now.getTime() - new Date(lastActivity).getTime()) / DAY_MS);
    const item: NudgeItem = {
      applicationId: row.id,
      company: row.companyName,
      role: row.role,
      status: row.status,
      daysQuiet,
    };
    if (daysQuiet >= config.staleDays) {
      stale.push(item);
    } else if (daysQuiet >= config.followUpDays) {
      nudges.push(item);
    }
  }
  nudges.sort((left, right) => right.daysQuiet - left.daysQuiet);
  stale.sort((left, right) => right.daysQuiet - left.daysQuiet);
  return { nudges, stale };
}
