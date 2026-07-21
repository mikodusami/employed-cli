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

/** Exported so tests can bootstrap a real "at version N" database via a filtered subset. */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    up: (database) => database.exec(readFileSync(SCHEMA_SQL_PATH, 'utf8')),
  },
  {
    version: 2,
    up: (database) =>
      database.exec(`
        CREATE TABLE http_cache (
          url TEXT PRIMARY KEY,
          etag TEXT,
          last_modified TEXT,
          body TEXT NOT NULL,
          content_type TEXT,
          fetched_at TEXT NOT NULL
        );
      `),
  },
  {
    version: 3,
    // NULL except on a system auto-filter (hard-exclude/location); distinguishes that from a
    // manual `dismiss`, which also sets status='dismissed' but leaves this column null.
    up: (database) => database.exec('ALTER TABLE jobs ADD COLUMN filter_reason TEXT;'),
  },
  {
    version: 4,
    up: (database) => {
      const rows = database
        .prepare<[], { id: number; scraper_config: string }>(
          'SELECT id, scraper_config FROM companies WHERE scraper_config IS NOT NULL',
        )
        .all();
      const update = database.prepare<[string, number]>(
        'UPDATE companies SET scraper_config = ? WHERE id = ?',
      );
      for (const row of rows) {
        const parsed = parseJsonObject(row.scraper_config);
        if (!parsed || parsed.planVersion === 2 || typeof parsed.strategy !== 'string') {
          continue;
        }
        update.run(
          JSON.stringify({ ...parsed, mode: 'dom', navigate: [], planVersion: 2 }),
          row.id,
        );
      }
    },
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

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
