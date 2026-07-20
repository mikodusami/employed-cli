/** Owns all persistence operations for provider-scoped AI responses. */
import type Database from 'better-sqlite3';

import type { AiCacheRow } from '../types.js';

export class AiCacheRepository {
  private readonly findStatement: Database.Statement<[string], AiCacheRow>;
  private readonly upsertStatement: Database.Statement;

  public constructor(database: Database.Database) {
    this.findStatement = database.prepare('SELECT * FROM ai_cache WHERE key = ?');
    this.upsertStatement = database.prepare(`
      INSERT INTO ai_cache (key, response, created_at)
      VALUES (@key, @response, @created_at)
      ON CONFLICT(key) DO UPDATE SET
        response = excluded.response,
        created_at = excluded.created_at
    `);
  }

  public find(key: string): AiCacheRow | undefined {
    return this.findStatement.get(key);
  }

  public upsert(key: string, response: string, createdAt: string): AiCacheRow {
    this.upsertStatement.run({ key, response, created_at: createdAt });
    const stored = this.find(key);
    if (!stored) {
      throw new Error(`AI cache write did not persist key ${key}.`);
    }
    return stored;
  }
}
