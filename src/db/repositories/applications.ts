/** Provides prepared, intent-oriented access to application records. */
import type Database from 'better-sqlite3';

import type { ApplicationRow, AppStatus } from '../types.js';

/** Values required to create an application. */
export interface CreateApplicationInput {
  job_id?: number | null;
  company_name: string;
  role?: string | null;
  status?: AppStatus;
  applied_at?: string | null;
  resume_version?: string | null;
  notes?: string | null;
}

/** Owns every SQL operation involving the applications table. */
export class ApplicationRepository {
  private readonly createStatement: Database.Statement<
    [
      {
        job_id: number | null;
        company_name: string;
        role: string | null;
        status: AppStatus;
        applied_at: string | null;
        resume_version: string | null;
        notes: string | null;
        created_at: string;
      },
    ],
    ApplicationRow
  >;
  private readonly findByIdStatement: Database.Statement<[{ id: number }], ApplicationRow>;
  private readonly findByCompanyRoleStatement: Database.Statement<
    [{ company_name: string; role: string | null }],
    ApplicationRow
  >;
  private readonly updateStatusStatement: Database.Statement<
    [{ id: number; status: AppStatus; occurred_at: string }],
    Database.RunResult
  >;

  public constructor(database: Database.Database) {
    this.createStatement = database.prepare(`
      INSERT INTO applications (
        job_id, company_name, role, status, applied_at, resume_version, notes, created_at
      ) VALUES (
        @job_id, @company_name, @role, @status, @applied_at, @resume_version, @notes, @created_at
      )
      RETURNING *
    `);
    this.findByIdStatement = database.prepare('SELECT * FROM applications WHERE id = @id');
    this.findByCompanyRoleStatement = database.prepare(`
      SELECT * FROM applications
      WHERE LOWER(company_name) = LOWER(@company_name)
        AND (@role IS NULL OR role IS NULL OR LOWER(role) = LOWER(@role))
      ORDER BY id DESC
      LIMIT 1
    `);
    this.updateStatusStatement = database.prepare(`
      UPDATE applications
      SET status = @status,
          last_activity_at = @occurred_at,
          first_response_at = COALESCE(first_response_at, @occurred_at)
      WHERE id = @id
    `);
  }

  /** Creates an application, stamping `created_at` with the caller's clock. */
  public create(input: CreateApplicationInput, createdAt: string): ApplicationRow {
    const created = this.createStatement.get({
      job_id: input.job_id ?? null,
      company_name: input.company_name,
      role: input.role ?? null,
      status: input.status ?? 'applied',
      applied_at: input.applied_at ?? null,
      resume_version: input.resume_version ?? null,
      notes: input.notes ?? null,
      created_at: createdAt,
    });
    if (!created) {
      throw new Error('Application create did not return a record.');
    }
    return created;
  }

  /**
   * Finds the most recent application for a company, optionally narrowed by role.
   *
   * @remarks A missing role on either side (the query or the stored row) is treated as
   * compatible rather than a mismatch, since email-extracted roles are best-effort.
   */
  public findByCompanyRole(companyName: string, role: string | null): ApplicationRow | undefined {
    return this.findByCompanyRoleStatement.get({ company_name: companyName, role });
  }

  /** Updates status, always touching `last_activity_at` and setting `first_response_at` once. */
  public updateStatus(id: number, status: AppStatus, occurredAt: string): ApplicationRow {
    this.updateStatusStatement.run({ id, status, occurred_at: occurredAt });
    return this.requireById(id);
  }

  private requireById(id: number): ApplicationRow {
    const application = this.findByIdStatement.get({ id });
    if (!application) {
      throw new Error(`Application ${id} does not exist.`);
    }
    return application;
  }
}
