/** Read access to persisted run observability for report projections. */
import type Database from 'better-sqlite3';

import type { RunRow } from '../types.js';

export class RunRepository {
  private readonly latestStatement: Database.Statement<[], RunRow>;

  public constructor(database: Database.Database) {
    this.latestStatement = database.prepare(`
      SELECT * FROM runs ORDER BY started_at DESC, id DESC LIMIT 1
    `);
  }

  public latest(): RunRow | undefined {
    return this.latestStatement.get();
  }
}
