/** Wires repository instances to a shared database connection. */
import type Database from 'better-sqlite3';

import { AiCacheRepository } from './ai-cache.js';
import { CompanyRepository } from './companies.js';
import { JobRepository } from './jobs.js';
import { RunRepository } from './runs.js';

/** Persistence repositories available to service and command layers. */
export class Repositories {
  public readonly aiCache: AiCacheRepository;
  public readonly companies: CompanyRepository;
  public readonly jobs: JobRepository;
  public readonly runs: RunRepository;

  public constructor(private readonly database: Database.Database) {
    this.aiCache = new AiCacheRepository(database);
    this.companies = new CompanyRepository(database);
    this.jobs = new JobRepository(database);
    this.runs = new RunRepository(database);
  }

  /** Runs a service operation atomically across repository calls. */
  public withTransaction<Result>(operation: () => Result): Result {
    return this.database.transaction(operation)();
  }
}

export type { InsertCompanyInput } from './companies.js';
export type {
  JobInsertInput,
  JobScoreUpdate,
  UpsertJobInput,
  UpsertJobResult,
} from './jobs.js';
