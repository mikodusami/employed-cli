/**
 * Named, typed queries backing `employed stats` — kept out of the service so each metric's SQL is
 * readable and testable on its own, and the service reads as "here are the metrics."
 */
import type Database from 'better-sqlite3';

import type { AppStatus, Band } from '../db/index.js';

/** One application's full outcome shape, joined against its linked job (if any) and event log. */
export interface ApplicationOutcomeRow {
  id: number;
  companyName: string;
  role: string | null;
  status: AppStatus;
  jobId: number | null;
  band: Band | null;
  resumeVersion: string | null;
  matchedKw: string | null;
  appliedAt: string | null;
  firstResponseAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  /** Event-scan: an `oa`/`interview`/`offer`/`rejected` event was ever recorded — not a status
   * read, so an application that interviewed and was later rejected still counts as responded. */
  responded: 0 | 1;
  /** Event-scan, narrower than `responded`: excludes a bare rejection with no earlier signal. */
  positiveResponded: 0 | 1;
  /** Event-scan: an `interview` event was ever recorded, regardless of what happened after. */
  interviewed: 0 | 1;
}

const LIST_APPLICATION_OUTCOMES = `
  SELECT
    a.id AS id,
    a.company_name AS companyName,
    a.role AS role,
    a.status AS status,
    a.job_id AS jobId,
    j.band AS band,
    a.resume_version AS resumeVersion,
    j.matched_kw AS matchedKw,
    a.applied_at AS appliedAt,
    a.first_response_at AS firstResponseAt,
    a.last_activity_at AS lastActivityAt,
    a.created_at AS createdAt,
    EXISTS(
      SELECT 1 FROM events e
      WHERE e.application_id = a.id AND e.type IN ('oa', 'interview', 'offer', 'rejected')
    ) AS responded,
    EXISTS(
      SELECT 1 FROM events e
      WHERE e.application_id = a.id AND e.type IN ('oa', 'interview', 'offer')
    ) AS positiveResponded,
    EXISTS(
      SELECT 1 FROM events e WHERE e.application_id = a.id AND e.type = 'interview'
    ) AS interviewed
  FROM applications a
  LEFT JOIN jobs j ON j.id = a.job_id
`;

/** Every application's outcome shape, one row each — every metric composes from this set. */
export function listApplicationOutcomes(db: Database.Database): readonly ApplicationOutcomeRow[] {
  return db.prepare<[], ApplicationOutcomeRow>(LIST_APPLICATION_OUTCOMES).all();
}
