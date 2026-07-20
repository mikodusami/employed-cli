/** Public surface for the employed persistence layer. */
export { createDb, getDatabaseVersion, withTransaction } from './connection.js';
export { Repositories } from './repositories/index.js';
export type {
  InsertCompanyInput,
  UpsertJobInput,
  UpsertJobResult,
} from './repositories/index.js';
export type {
  AiCacheRow,
  AppStatus,
  ApplicationRow,
  Band,
  CompanyRow,
  EmailThreadRow,
  EventRow,
  EventType,
  Health,
  JobRow,
  JobStatus,
  RunRow,
  ScrapeMethod,
  Tier,
} from './types.js';
