/** Provides prepared, intent-oriented access to the append-only application event log. */
import type Database from 'better-sqlite3';

import type { EventRow, EventType } from '../types.js';

/** Values required to append one event. */
export interface AppendEventInput {
  application_id: number;
  at: string;
  type: EventType;
  note?: string | null;
}

/** Owns every SQL operation involving the events table. */
export class EventRepository {
  private readonly appendStatement: Database.Statement<
    [{ application_id: number; at: string; type: EventType; note: string | null }],
    EventRow
  >;
  private readonly listForApplicationStatement: Database.Statement<
    [{ application_id: number }],
    EventRow
  >;

  public constructor(database: Database.Database) {
    this.appendStatement = database.prepare(`
      INSERT INTO events (application_id, at, type, note)
      VALUES (@application_id, @at, @type, @note)
      RETURNING *
    `);
    this.listForApplicationStatement = database.prepare(`
      SELECT * FROM events WHERE application_id = @application_id ORDER BY at, id
    `);
  }

  /** Lists one application's full audit trail, oldest to newest. */
  public listForApplication(applicationId: number): readonly EventRow[] {
    return this.listForApplicationStatement.all({ application_id: applicationId });
  }

  /** Appends one immutable event row; events are never updated or deleted. */
  public append(input: AppendEventInput): EventRow {
    const event = this.appendStatement.get({
      application_id: input.application_id,
      at: input.at,
      type: input.type,
      note: input.note ?? null,
    });
    if (!event) {
      throw new Error('Event append did not return a record.');
    }
    return event;
  }
}
