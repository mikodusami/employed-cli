/** Wires repository instances to a shared database connection. */
import type Database from 'better-sqlite3';

import { AiCacheRepository } from './ai-cache.js';
import { ApplicationRepository } from './applications.js';
import { CompanyRepository } from './companies.js';
import { EmailThreadRepository } from './email-threads.js';
import { EventRepository } from './events.js';
import { JobRepository } from './jobs.js';
import { RunRepository } from './runs.js';
import type { ApplicationRow, CompanyRow, EventRow, JobRow } from '../types.js';

export interface SnapshotRows {
  companies: readonly CompanyRow[];
  jobs: readonly JobRow[];
  applications: readonly ApplicationRow[];
  events: readonly EventRow[];
}

export interface SnapshotRestoreCounts {
  companies: number;
  jobs: number;
  applications: number;
  events: number;
}

/** Persistence repositories available to service and command layers. */
export class Repositories {
  public readonly aiCache: AiCacheRepository;
  public readonly applications: ApplicationRepository;
  public readonly companies: CompanyRepository;
  public readonly emailThreads: EmailThreadRepository;
  public readonly events: EventRepository;
  public readonly jobs: JobRepository;
  public readonly runs: RunRepository;

  public constructor(private readonly database: Database.Database) {
    this.aiCache = new AiCacheRepository(database);
    this.applications = new ApplicationRepository(database);
    this.companies = new CompanyRepository(database);
    this.emailThreads = new EmailThreadRepository(database);
    this.events = new EventRepository(database);
    this.jobs = new JobRepository(database);
    this.runs = new RunRepository(database);
  }

  /** Runs a service operation atomically across repository calls. */
  public withTransaction<Result>(operation: () => Result): Result {
    return this.database.transaction(operation)();
  }

  /** Restores a trusted, version-validated native snapshot while preserving foreign-key ids. */
  public restoreSnapshot(snapshot: SnapshotRows): SnapshotRestoreCounts {
    return this.withTransaction(() => {
      const counts = { companies: 0, jobs: 0, applications: 0, events: 0 };
      counts.companies = insertRows(this.database, 'companies', snapshot.companies);
      counts.jobs = insertRows(this.database, 'jobs', snapshot.jobs);
      counts.applications = insertRows(this.database, 'applications', snapshot.applications);
      counts.events = insertRows(this.database, 'events', snapshot.events);
      return counts;
    });
  }
}

function insertRows<Row extends object>(
  database: Database.Database,
  table: 'companies' | 'jobs' | 'applications' | 'events',
  rows: readonly Row[],
): number {
  let created = 0;
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const existing = database
      .prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .get(record.id) as Record<string, unknown> | undefined;
    if (existing) {
      if (!sameRow(existing, record)) {
        throw new Error(`Snapshot conflicts with existing ${table} row ${String(record.id)}.`);
      }
      continue;
    }
    const columns = Object.keys(record);
    const names = columns.map((column) => `"${column}"`).join(', ');
    const values = columns.map((column) => `@${column}`).join(', ');
    const statement = `INSERT OR IGNORE INTO ${table} (${names}) VALUES (${values})`;
    const result = database.prepare(statement).run(record);
    if (result.changes !== 1) {
      throw new Error(`Snapshot ${table} row ${String(record.id)} conflicts with local data.`);
    }
    created += result.changes;
  }
  return created;
}

function sameRow(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  return Object.keys(incoming).every((column) => existing[column] === incoming[column]);
}

export type { ApplicationFilter, CreateApplicationInput } from './applications.js';
export type { InsertCompanyInput } from './companies.js';
export type { MarkProcessedInput } from './email-threads.js';
export type { AppendEventInput } from './events.js';
export type {
  JobInsertInput,
  JobScoreUpdate,
  UpsertJobInput,
  UpsertJobResult,
} from './jobs.js';
export type { FinishRunInput } from './runs.js';
