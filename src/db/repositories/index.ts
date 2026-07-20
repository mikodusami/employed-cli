/** Wires repository instances to a shared database connection. */
import type Database from 'better-sqlite3';

import { AiCacheRepository } from './ai-cache.js';
import { ApplicationRepository } from './applications.js';
import { CompanyRepository } from './companies.js';
import { EmailThreadRepository } from './email-threads.js';
import { EventRepository } from './events.js';
import { JobRepository } from './jobs.js';
import { RunRepository } from './runs.js';

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
}

export type { CreateApplicationInput } from './applications.js';
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
