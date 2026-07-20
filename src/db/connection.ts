/** Creates configured SQLite connections and service-level transaction wrappers. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { DB_PATH } from '../constants.js';
import { migrate } from './migrate.js';

/** Opens, configures, and migrates an employed database. */
export function createDb(databasePath = DB_PATH): Database.Database {
  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  migrate(database);
  return database;
}

/** Returns the schema version recorded by SQLite's migration pragma. */
export function getDatabaseVersion(database: Database.Database): number {
  return database.pragma('user_version', { simple: true }) as number;
}

/** Runs a service operation as one atomic database transaction. */
export function withTransaction<Result>(
  database: Database.Database,
  operation: () => Result,
): Result {
  return database.transaction(operation)();
}
