/** Canonical persistence and domain types shared by application features. */

/** Company priority tier. */
export type Tier = 'A' | 'B' | 'C';

/** Supported careers-site integration. */
export type ScrapeMethod = 'unknown' | 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'custom';

/** Current health of a company's scraper. */
export type Health = 'unknown' | 'healthy' | 'degraded' | 'failing';

/** Lifecycle state for a discovered job. */
export type JobStatus = 'open' | 'closed' | 'dismissed';

/** Lifecycle state for a job application. */
export type AppStatus =
  | 'planned'
  | 'applied'
  | 'interviewing'
  | 'offered'
  | 'rejected'
  | 'withdrawn';

/** Event categories recorded against an application. */
export type EventType =
  | 'created'
  | 'applied'
  | 'email'
  | 'interview'
  | 'offer'
  | 'rejection'
  | 'note';

/** Coarse job-match score classification. */
export type Band = 'strong' | 'possible' | 'weak';

/** Stored company record. */
export interface CompanyRow {
  id: number;
  name: string;
  tier: Tier;
  careers_url: string;
  scrape_method: ScrapeMethod;
  scrape_slug: string | null;
  scrape_config: string | null;
  health: Health;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  last_yield_count: number;
  created_at: string;
  updated_at: string;
}

/** Stored job record. */
export interface JobRow {
  id: number;
  company_id: number;
  title: string;
  location: string | null;
  url: string;
  description: string | null;
  salary: string | null;
  posted_at: string | null;
  first_seen: string;
  last_seen: string;
  status: JobStatus;
  dedupe_key: string;
  score: number | null;
  band: Band | null;
  score_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Stored application record. */
export interface ApplicationRow {
  id: number;
  job_id: number;
  status: AppStatus;
  applied_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Stored application event. */
export interface EventRow {
  id: number;
  application_id: number;
  type: EventType;
  occurred_at: string;
  description: string | null;
  metadata: string | null;
  created_at: string;
}

/** Stored email-thread association. */
export interface EmailThreadRow {
  id: number;
  application_id: number | null;
  provider_thread_id: string;
  subject: string | null;
  last_message_at: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

/** Stored background or interactive run. */
export interface RunRow {
  id: number;
  kind: string;
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  finished_at: string | null;
  companies_checked: number;
  jobs_found: number;
  jobs_added: number;
  error: string | null;
  metadata: string | null;
}

/** Stored AI response cache entry. */
export interface AiCacheRow {
  id: number;
  cache_key: string;
  provider: string;
  model: string;
  response: string;
  created_at: string;
  expires_at: string | null;
}
