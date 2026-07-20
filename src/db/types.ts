/** Canonical persistence and domain types shared by application features. */

/** Company priority tier. */
export type Tier = 'A' | 'B' | 'C';

/** Supported careers-site integration. */
export type ScrapeMethod =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'smartrecruiters'
  | 'recruitee'
  | 'generated-static'
  | 'generated-playwright'
  | 'unknown'
  | 'manual';

/** Current health of a company's scraper. */
export type Health = 'ok' | 'degraded' | 'broken' | 'untested';

/** Lifecycle state for a discovered job. */
export type JobStatus = 'open' | 'closed' | 'dismissed';

/** Lifecycle state for a job application. */
export type AppStatus = 'saved' | 'applied' | 'oa' | 'interview' | 'offer' | 'rejected';

/** Event categories recorded against an application. */
export type EventType = 'applied' | 'oa' | 'interview' | 'offer' | 'rejected' | 'note' | 'email';

/** Coarse job-match score classification. */
export type Band = 'A' | 'B' | 'C' | 'D';

/** Stored company record. */
export interface CompanyRow {
  id: number;
  name: string;
  slug: string | null;
  careers_url: string;
  tier: Tier;
  scrape_method: ScrapeMethod;
  scraper_config: string | null;
  health: Health;
  consecutive_failures: number;
  last_success: string | null;
  last_yield: number | null;
  created_at: string;
}

/** Stored job record. */
export interface JobRow {
  id: number;
  company_id: number;
  dedupe_key: string;
  title: string;
  url: string;
  location: string | null;
  department: string | null;
  description: string | null;
  score: number | null;
  band: Band | null;
  matched_kw: string | null;
  status: JobStatus;
  first_seen: string;
  last_seen: string;
}

/** Stored application record. */
export interface ApplicationRow {
  id: number;
  job_id: number | null;
  company_name: string;
  role: string | null;
  status: AppStatus;
  applied_at: string | null;
  resume_version: string | null;
  notes: string | null;
  first_response_at: string | null;
  last_activity_at: string | null;
  created_at: string;
}

/** Stored application event. */
export interface EventRow {
  id: number;
  application_id: number;
  at: string;
  type: EventType;
  note: string | null;
}

/** Stored email-thread association. */
export interface EmailThreadRow {
  thread_id: string;
  application_id: number | null;
  classified_as: string | null;
  processed_at: string;
}

/** Stored background or interactive run. */
export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  companies_scanned: number | null;
  jobs_seen: number | null;
  jobs_new: number | null;
  failures: string | null;
  claude_calls: number | null;
  notes: string | null;
}

/** Stored AI response cache entry. */
export interface AiCacheRow {
  key: string;
  response: string;
  created_at: string;
}
