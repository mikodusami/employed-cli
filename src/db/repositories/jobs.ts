/** Provides prepared, intent-oriented access to discovered job records. */
import type Database from 'better-sqlite3';

import type { Band, JobRow } from '../types.js';

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

/** Owns every SQL operation involving the jobs table. */
export class JobRepository {
  private readonly existsStatement: Database.Statement<[JobIdentityParameter], { id: number }>;
  private readonly upsertStatement: Database.Statement<[JobInsertInput], JobRow>;
  private readonly findNewSinceStatement: Database.Statement<[{ date: string }], JobRow>;
  private readonly dismissStatement: Database.Statement<[{ id: number }], Database.RunResult>;
  private readonly findByIdStatement: Database.Statement<[{ id: number }], JobRow>;

  public constructor(database: Database.Database) {
    this.existsStatement = database.prepare(`
      SELECT id FROM jobs WHERE company_id = @company_id AND dedupe_key = @dedupe_key
    `);
    this.upsertStatement = database.prepare(`
      INSERT INTO jobs (
        company_id, title, location, url, department, description,
        first_seen, last_seen, dedupe_key, score, band, matched_kw
      ) VALUES (
        @company_id, @title, @location, @url, @department, @description,
        @first_seen, @last_seen, @dedupe_key, @score, @band, @matched_kw
      )
      ON CONFLICT(company_id, dedupe_key) DO UPDATE SET
        last_seen = excluded.last_seen
      RETURNING *
    `);
    this.findNewSinceStatement = database.prepare(`
      SELECT * FROM jobs WHERE first_seen >= @date ORDER BY first_seen DESC, id DESC
    `);
    this.dismissStatement = database.prepare(`
      UPDATE jobs SET status = 'dismissed' WHERE id = @id
    `);
    this.findByIdStatement = database.prepare('SELECT * FROM jobs WHERE id = @id');
  }

  /** Inserts a job or refreshes only its last-seen timestamp when already known. */
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

  /** Reserves the lifecycle boundary for the two-run closure rule. */
  public markClosedIfUnseen(_companyId: number, _runDate: string): number {
    return 0;
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
}
