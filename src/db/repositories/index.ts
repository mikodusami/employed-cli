/** Wires repository instances to a shared database connection. */
import type Database from 'better-sqlite3';

import { CompanyRepository } from './companies.js';
import { JobRepository } from './jobs.js';

/** Persistence repositories available to service and command layers. */
export class Repositories {
  public readonly companies: CompanyRepository;
  public readonly jobs: JobRepository;

  public constructor(database: Database.Database) {
    this.companies = new CompanyRepository(database);
    this.jobs = new JobRepository(database);
  }
}

export type { InsertCompanyInput } from './companies.js';
export type { UpsertJobInput, UpsertJobResult } from './jobs.js';
