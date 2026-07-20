/** Serializable source of truth shared by every `employed stats` renderer. */
import type { AppStatus, Band } from '../db/index.js';

export interface BandOutcomeRow {
  band: Band;
  total: number;
  responseRate: number | null;
  interviewRate: number | null;
}

export interface ResumeOutcomeRow {
  resumeVersion: string;
  total: number;
  responseRate: number | null;
  interviewRate: number | null;
  /** True when `total` is below `stats.minResumeSample` — shown, not hidden, per the spec. */
  lowSignal: boolean;
}

export interface KeywordCorrelationRow {
  keyword: string;
  total: number;
  responseRate: number;
}

/** An application worth a human look: quiet a while, and not already at a terminal outcome. */
export interface NudgeItem {
  applicationId: number;
  company: string;
  role: string | null;
  status: AppStatus;
  daysQuiet: number;
}

export interface Sparkline {
  /** Oldest to newest, left to right. */
  weeklyCounts: readonly number[];
  chart: string;
}

export interface StatsReport {
  totalApplications: number;
  responseRate: number | null;
  positiveResponseRate: number | null;
  interviewRate: number | null;
  avgDaysToFirstResponse: number | null;
  sparkline: Sparkline;
  outcomesByBand: readonly BandOutcomeRow[];
  /** Applications with no linked job (or a job with no band) — excluded from `outcomesByBand`. */
  excludedFromBandTable: number;
  outcomesByResume: readonly ResumeOutcomeRow[];
  keywordCorrelation: readonly KeywordCorrelationRow[];
  nudges: readonly NudgeItem[];
  stale: readonly NudgeItem[];
}
