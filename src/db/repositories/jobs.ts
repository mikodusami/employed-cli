/** Provides prepared, intent-oriented access to discovered job records. */
import type Database from 'better-sqlite3';

import type { Band, JobRow, JobStatus } from '../types.js';

/** Values required to insert or refresh a job. */
export interface JobInsertInput {
  company_id: number;
  title: string;
  location?: string | null;
  url: string;
  department?: string | null;
  description?: string | null;
  first_seen: string;
  last_seen: string;
  dedupe_key: string;
  score?: number | null;
  band?: Band | null;
  matched_kw?: string | null;
  /** Defaults to 'open'; the hard-exclude/location gate sets 'dismissed' on a new match. */
  status?: JobStatus;
  /** Set alongside `status: 'dismissed'` by the auto-filter; null for a normal open job. */
  filter_reason?: string | null;
}

/** Backward-compatible name for callers created before normalization was introduced. */
export type UpsertJobInput = JobInsertInput;

interface JobIdentityParameter {
  company_id: number;
  dedupe_key: string;
}

/** Result of inserting a new job or refreshing an existing one. */
export interface UpsertJobResult {
  job: JobRow;
  isNew: boolean;
}

export interface JobScoreUpdate {
  id: number;
  score: number;
  band: Band;
  matched_kw: string;
}

/** Owns every SQL operation involving the jobs table. */
export class JobRepository {
  private readonly existsStatement: Database.Statement<[JobIdentityParameter], { id: number }>;
  private readonly upsertStatement: Database.Statement<[JobInsertInput], JobRow>;
  private readonly findNewSinceStatement: Database.Statement<[{ date: string }], JobRow>;
  private readonly dismissStatement: Database.Statement<[{ id: number }], Database.RunResult>;
  private readonly restoreStatement: Database.Statement<[{ id: number }], Database.RunResult>;
  private readonly findByIdStatement: Database.Statement<[{ id: number }], JobRow>;
  private readonly listStatement: Database.Statement<[], JobRow>;
  private readonly listOpenStatement: Database.Statement<[], JobRow>;
  private readonly listOpenFirstSeenOnStatement: Database.Statement<[{ date: string }], JobRow>;
  private readonly listAutoFilteredFirstSeenOnStatement: Database.Statement<
    [{ date: string }],
    JobRow
  >;
  private readonly updateScoreStatement: Database.Statement<[JobScoreUpdate], Database.RunResult>;
  private readonly markClosedIfUnseenStatement: Database.Statement<
    [{ company_id: number; cutoff: string }],
    Database.RunResult
  >;

  public constructor(database: Database.Database) {
    this.existsStatement = database.prepare(`
      SELECT id FROM jobs WHERE company_id = @company_id AND dedupe_key = @dedupe_key
    `);
    this.upsertStatement = database.prepare(`
      INSERT INTO jobs (
        company_id, title, location, url, department, description,
        first_seen, last_seen, dedupe_key, score, band, matched_kw, status, filter_reason
      ) VALUES (
        @company_id, @title, @location, @url, @department, @description,
        @first_seen, @last_seen, @dedupe_key, @score, @band, @matched_kw, @status, @filter_reason
      )
      ON CONFLICT(company_id, dedupe_key) DO UPDATE SET
        last_seen = excluded.last_seen,
        score = excluded.score,
        band = excluded.band,
        matched_kw = excluded.matched_kw,
        status = CASE WHEN jobs.status = 'open' THEN excluded.status ELSE jobs.status END,
        filter_reason = CASE
          WHEN jobs.status = 'open' THEN excluded.filter_reason
          ELSE jobs.filter_reason
        END
      RETURNING *
    `);
    this.findNewSinceStatement = database.prepare(`
      SELECT * FROM jobs WHERE first_seen >= @date ORDER BY first_seen DESC, id DESC
    `);
    this.dismissStatement = database.prepare(`
      UPDATE jobs SET status = 'dismissed' WHERE id = @id
    `);
    this.restoreStatement = database.prepare(`
      UPDATE jobs SET status = 'open', filter_reason = NULL WHERE id = @id
    `);
    this.findByIdStatement = database.prepare('SELECT * FROM jobs WHERE id = @id');
    this.listStatement = database.prepare('SELECT * FROM jobs ORDER BY id');
    this.listOpenStatement = database.prepare(`
      SELECT * FROM jobs WHERE status = 'open' ORDER BY id
    `);
    this.listOpenFirstSeenOnStatement = database.prepare(`
      SELECT * FROM jobs
      WHERE status = 'open' AND date(first_seen) = date(@date)
      ORDER BY id
    `);
    this.listAutoFilteredFirstSeenOnStatement = database.prepare(`
      SELECT * FROM jobs
      WHERE filter_reason IS NOT NULL AND date(first_seen) = date(@date)
      ORDER BY id
    `);
    this.updateScoreStatement = database.prepare(`
      UPDATE jobs
      SET score = @score, band = @band, matched_kw = @matched_kw
      WHERE id = @id
    `);
    this.markClosedIfUnseenStatement = database.prepare(`
      UPDATE jobs
      SET status = 'closed'
      WHERE company_id = @company_id AND status = 'open' AND last_seen < @cutoff
    `);
  }

  /**
   * Inserts a job, or refreshes an existing one's score/status.
   *
   * @remarks On conflict, `status`/`filter_reason` only change when the stored row is currently
   * 'open' — so a manually `dismiss`ed job, or one already auto-filtered, is never silently
   * revived or re-labeled by a later scrape. The only way back to 'open' is explicit: `restore`.
   */
  public upsert(input: JobInsertInput): UpsertJobResult {
    const identity = { company_id: input.company_id, dedupe_key: input.dedupe_key };
    const isNew = this.existsStatement.get(identity) === undefined;
    const parameters: JobInsertInput = {
      ...input,
      location: input.location ?? null,
      department: input.department ?? null,
      description: input.description ?? null,
      score: input.score ?? null,
      band: input.band ?? null,
      matched_kw: input.matched_kw ?? null,
      status: input.status ?? 'open',
      filter_reason: input.filter_reason ?? null,
    };
    const job = this.upsertStatement.get(parameters);
    if (!job) {
      throw new Error('Job upsert did not return a record.');
    }
    return { job, isNew };
  }

  /** Finds jobs first discovered at or after an ISO timestamp. */
  public findNewSince(date: string): readonly JobRow[] {
    return this.findNewSinceStatement.all({ date });
  }

  /** Lists every currently open job for deterministic offline re-scoring. */
  public listOpen(): readonly JobRow[] {
    return this.listOpenStatement.all();
  }

  /** Lists every job state for complete, lossless exports. */
  public list(): readonly JobRow[] {
    return this.listStatement.all();
  }

  /** Finds a job by id, or undefined when it does not exist. */
  public findById(id: number): JobRow | undefined {
    return this.findByIdStatement.get({ id });
  }

  /** Lists open jobs first discovered on one calendar date. */
  public listOpenFirstSeenOn(date: string): readonly JobRow[] {
    return this.listOpenFirstSeenOnStatement.all({ date });
  }

  /** Lists system auto-filtered jobs (`filter_reason` set) first discovered on one date. */
  public listAutoFilteredFirstSeenOn(date: string): readonly JobRow[] {
    return this.listAutoFilteredFirstSeenOnStatement.all({ date });
  }

  /** Persists a score computed by the pure scoring engine. */
  public updateScore(input: JobScoreUpdate): JobRow {
    this.updateScoreStatement.run(input);
    const job = this.findByIdStatement.get({ id: input.id });
    if (!job) {
      throw new Error(`Job ${input.id} does not exist.`);
    }
    return job;
  }

  /**
   * Closes open jobs whose `last_seen` predates a company's prior successful scrape.
   *
   * @remarks A job untouched since before that cutoff was already missing on the previous
   * successful scrape (first miss, left open) and is still missing now (second consecutive
   * miss), satisfying the two-run closure rule without a dedicated miss counter.
   */
  public markClosedIfUnseen(companyId: number, cutoff: string): number {
    const result = this.markClosedIfUnseenStatement.run({ company_id: companyId, cutoff });
    return result.changes;
  }

  /** Marks a job as intentionally dismissed and returns the updated record. */
  public dismiss(id: number): JobRow {
    this.dismissStatement.run({ id });
    const job = this.findByIdStatement.get({ id });
    if (!job) {
      throw new Error(`Job ${id} does not exist.`);
    }
    return job;
  }

  /**
   * Reopens a job and clears `filter_reason` — the safety valve for an over-aggressive filter.
   *
   * @remarks Callers are expected to check `filter_reason IS NOT NULL` first (via `findById`) and
   * refuse on a manually-dismissed job; this method itself applies unconditionally to whatever id
   * it's given, matching the plain update/re-fetch pattern the rest of this repository uses.
   */
  public restore(id: number): JobRow {
    this.restoreStatement.run({ id });
    const job = this.findByIdStatement.get({ id });
    if (!job) {
      throw new Error(`Job ${id} does not exist.`);
    }
    return job;
  }
}
