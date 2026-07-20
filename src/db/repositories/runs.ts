/** Owns every SQL operation involving the runs observability table. */
import type Database from 'better-sqlite3';

import type { RunRow } from '../types.js';

/** Values recorded when a run finishes, including partial data from an aborted run. */
export interface FinishRunInput {
  id: number;
  finished_at: string;
  companies_scanned: number;
  jobs_seen: number;
  jobs_new: number;
  failures: string | null;
  claude_calls: number;
  notes?: string | null;
}

export class RunRepository {
  private readonly startStatement: Database.Statement<[{ started_at: string }], Database.RunResult>;
  private readonly finishStatement: Database.Statement<[FinishRunInput], Database.RunResult>;
  private readonly countStatement: Database.Statement<[], { count: number }>;
  private readonly findByIdStatement: Database.Statement<[{ id: number }], RunRow>;
  private readonly latestStatement: Database.Statement<[], RunRow>;

  public constructor(database: Database.Database) {
    this.startStatement = database.prepare(`
      INSERT INTO runs (started_at) VALUES (@started_at)
    `);
    this.finishStatement = database.prepare(`
      UPDATE runs
      SET finished_at = @finished_at,
          companies_scanned = @companies_scanned,
          jobs_seen = @jobs_seen,
          jobs_new = @jobs_new,
          failures = @failures,
          claude_calls = @claude_calls,
          notes = @notes
      WHERE id = @id
    `);
    this.countStatement = database.prepare('SELECT COUNT(*) AS count FROM runs');
    this.findByIdStatement = database.prepare('SELECT * FROM runs WHERE id = @id');
    this.latestStatement = database.prepare(`
      SELECT * FROM runs ORDER BY started_at DESC, id DESC LIMIT 1
    `);
  }

  /** Opens a new run row; a crashed run leaves `finished_at` null as a doctor-visible signal. */
  public start(startedAt: string): RunRow {
    const result = this.startStatement.run({ started_at: startedAt });
    return this.requireById(Number(result.lastInsertRowid));
  }

  /** Closes a run row with its final counts, called from the orchestrator's `finally`. */
  public finish(input: FinishRunInput): RunRow {
    this.finishStatement.run({ ...input, notes: input.notes ?? null });
    return this.requireById(input.id);
  }

  /** Counts every recorded run, the monotonic source for the tier scheduler's run index. */
  public count(): number {
    return this.countStatement.get()?.count ?? 0;
  }

  public latest(): RunRow | undefined {
    return this.latestStatement.get();
  }

  private requireById(id: number): RunRow {
    const run = this.findByIdStatement.get({ id });
    if (!run) {
      throw new Error(`Run ${id} does not exist.`);
    }
    return run;
  }
}
