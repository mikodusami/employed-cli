/** Serializable source of truth shared by every daily-report renderer. */
import type { Band } from '../db/types.js';

export interface RunStats {
  companiesScanned: number;
  jobsSeen: number;
  jobsNew: number;
  failures: number;
  healed: number;
  broken: number;
}

export interface ReportJob {
  score: number;
  band: Band;
  company: string;
  title: string;
  location: string | null;
  url: string;
  ageDays: number;
  titleOnly: boolean;
}

export interface AutoAppliedUpdate {
  company: string;
  role: string;
  status: string;
}

export interface AttentionItem {
  type: 'broken-scraper' | 'follow-up';
  company: string;
  message: string;
}

export interface DailyReport {
  date: string;
  summary?: string;
  runStats: RunStats | null;
  newJobsByBand: Record<Band, ReportJob[]>;
  autoApplied: AutoAppliedUpdate[];
  needsAttention: AttentionItem[];
}

/** Applies one band selection identically for terminal, Markdown, and JSON. */
export function filterReport(report: DailyReport, bands: ReadonlySet<Band>): DailyReport {
  return {
    ...report,
    newJobsByBand: {
      A: bands.has('A') ? report.newJobsByBand.A : [],
      B: bands.has('B') ? report.newJobsByBand.B : [],
      C: bands.has('C') ? report.newJobsByBand.C : [],
      D: bands.has('D') ? report.newJobsByBand.D : [],
    },
  };
}
