/** Provides prepared, intent-oriented access to the Gmail sync idempotency ledger. */
import type Database from 'better-sqlite3';

import type { EmailThreadRow } from '../types.js';

/** Values required to mark one thread processed. */
export interface MarkProcessedInput {
  thread_id: string;
  application_id?: number | null;
  classified_as?: string | null;
  processed_at: string;
}

interface MarkProcessedRow {
  thread_id: string;
  application_id: number | null;
  classified_as: string | null;
  processed_at: string;
}

/** Owns every SQL operation involving the email_threads idempotency ledger. */
export class EmailThreadRepository {
  private readonly upsertStatement: Database.Statement<
    [MarkProcessedRow],
    Database.RunResult
  >;
  private readonly isSeenStatement: Database.Statement<
    [{ thread_id: string }],
    { thread_id: string }
  >;
  private readonly findStatement: Database.Statement<[{ thread_id: string }], EmailThreadRow>;

  public constructor(private readonly database: Database.Database) {
    this.upsertStatement = database.prepare(`
      INSERT INTO email_threads (thread_id, application_id, classified_as, processed_at)
      VALUES (@thread_id, @application_id, @classified_as, @processed_at)
      ON CONFLICT(thread_id) DO UPDATE SET
        application_id = excluded.application_id,
        classified_as = excluded.classified_as,
        processed_at = excluded.processed_at
    `);
    this.isSeenStatement = database.prepare(`
      SELECT thread_id FROM email_threads WHERE thread_id = @thread_id
    `);
    this.findStatement = database.prepare(`
      SELECT * FROM email_threads WHERE thread_id = @thread_id
    `);
  }

  /** Reads the full ledger row, for audit and test introspection. */
  public find(threadId: string): EmailThreadRow | undefined {
    return this.findStatement.get({ thread_id: threadId });
  }

  /** Records a thread as processed; a re-processed thread simply refreshes its ledger row. */
  public markProcessed(input: MarkProcessedInput): void {
    this.upsertStatement.run({
      thread_id: input.thread_id,
      application_id: input.application_id ?? null,
      classified_as: input.classified_as ?? null,
      processed_at: input.processed_at,
    });
  }

  public isSeen(threadId: string): boolean {
    return this.isSeenStatement.get({ thread_id: threadId }) !== undefined;
  }

  /** Batch membership check so a sync's seen-filter is one query, not N. */
  public seenThreadIds(threadIds: readonly string[]): ReadonlySet<string> {
    if (threadIds.length === 0) {
      return new Set();
    }
    const placeholders = threadIds.map(() => '?').join(', ');
    const rows = this.database
      .prepare<string[], EmailThreadRow>(
        `SELECT * FROM email_threads WHERE thread_id IN (${placeholders})`,
      )
      .all(...threadIds);
    return new Set(rows.map((row) => row.thread_id));
  }
}
