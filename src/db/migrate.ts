/** Applies forward-only SQLite schema migrations atomically. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';

const SCHEMA_SQL_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

/** A single ordered database migration. */
export interface Migration {
  version: number;
  up(database: Database.Database): void;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    up: (database) => database.exec(readFileSync(SCHEMA_SQL_PATH, 'utf8')),
  },
];

/** Runs every migration newer than the database's current user version. */
export function migrate(
  database: Database.Database,
  migrationPlan: readonly Migration[] = migrations,
): void {
  const currentVersion = database.pragma('user_version', { simple: true }) as number;
  const pendingMigrations = migrationPlan
    .filter(({ version }) => version > currentVersion)
    .sort((left, right) => left.version - right.version);

  for (const migration of pendingMigrations) {
    database.transaction(() => {
      migration.up(database);
      database.pragma(`user_version = ${migration.version}`);
    })();
  }
}
