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

/** Narrows `list` to one status; omitted, every application is returned. */
export interface ApplicationFilter {
  status?: AppStatus;
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
  private readonly findByJobIdStatement: Database.Statement<[{ job_id: number }], ApplicationRow>;
  private readonly findByCompanyRoleStatement: Database.Statement<
    [{ company_name: string; role: string | null }],
    ApplicationRow
  >;
  private readonly listStatement: Database.Statement<[], ApplicationRow>;
  private readonly listByStatusStatement: Database.Statement<
    [{ status: AppStatus }],
    ApplicationRow
  >;
  private readonly updateStatusStatement: Database.Statement<
    [{ id: number; status: AppStatus }],
    Database.RunResult
  >;
  private readonly updateResumeVersionStatement: Database.Statement<
    [{ id: number; resume_version: string | null }],
    Database.RunResult
  >;
  private readonly updateNotesStatement: Database.Statement<
    [{ id: number; notes: string | null }],
    Database.RunResult
  >;
  private readonly touchActivityStatement: Database.Statement<
    [{ id: number; occurred_at: string }],
    Database.RunResult
  >;
  private readonly setFirstResponseStatement: Database.Statement<
    [{ id: number; occurred_at: string }],
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
    this.findByJobIdStatement = database.prepare(`
      SELECT * FROM applications WHERE job_id = @job_id ORDER BY id DESC LIMIT 1
    `);
    this.findByCompanyRoleStatement = database.prepare(`
      SELECT * FROM applications
      WHERE LOWER(company_name) = LOWER(@company_name)
        AND (@role IS NULL OR role IS NULL OR LOWER(role) = LOWER(@role))
      ORDER BY id DESC
      LIMIT 1
    `);
    this.listStatement = database.prepare(`
      SELECT * FROM applications ORDER BY last_activity_at DESC, id DESC
    `);
    this.listByStatusStatement = database.prepare(`
      SELECT * FROM applications WHERE status = @status ORDER BY last_activity_at DESC, id DESC
    `);
    this.updateStatusStatement = database.prepare(`
      UPDATE applications SET status = @status WHERE id = @id
    `);
    this.updateResumeVersionStatement = database.prepare(`
      UPDATE applications SET resume_version = @resume_version WHERE id = @id
    `);
    this.updateNotesStatement = database.prepare(`
      UPDATE applications SET notes = @notes WHERE id = @id
    `);
    this.touchActivityStatement = database.prepare(`
      UPDATE applications SET last_activity_at = @occurred_at WHERE id = @id
    `);
    this.setFirstResponseStatement = database.prepare(`
      UPDATE applications
      SET first_response_at = COALESCE(first_response_at, @occurred_at)
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

  /** Finds an application by id, or undefined when it does not exist. */
  public findById(id: number): ApplicationRow | undefined {
    return this.findByIdStatement.get({ id });
  }

  /** Finds the application linked to a scraped job, if one has been created from it. */
  public findByJobId(jobId: number): ApplicationRow | undefined {
    return this.findByJobIdStatement.get({ job_id: jobId });
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

  /** Lists applications, most recently active first, optionally narrowed to one status. */
  public list(filter: ApplicationFilter = {}): readonly ApplicationRow[] {
    return filter.status ? this.listByStatus(filter.status) : this.listStatement.all();
  }

  /** Lists applications in one status, most recently active first. */
  public listByStatus(status: AppStatus): readonly ApplicationRow[] {
    return this.listByStatusStatement.all({ status });
  }

  /**
   * Sets status only; activity timestamps are separate, explicit calls owned by the caller
   * (`ApplicationService.transition` is the only intended caller of all three together).
   */
  public updateStatus(id: number, status: AppStatus): ApplicationRow {
    this.updateStatusStatement.run({ id, status });
    return this.requireById(id);
  }

  public updateResumeVersion(id: number, resumeVersion: string | null): ApplicationRow {
    this.updateResumeVersionStatement.run({ id, resume_version: resumeVersion });
    return this.requireById(id);
  }

  public updateNotes(id: number, notes: string | null): ApplicationRow {
    this.updateNotesStatement.run({ id, notes });
    return this.requireById(id);
  }

  /** Bumps `last_activity_at`; called on every write that represents new activity. */
  public touchActivity(id: number, occurredAt: string): ApplicationRow {
    this.touchActivityStatement.run({ id, occurred_at: occurredAt });
    return this.requireById(id);
  }

  /** Sets `first_response_at` once, on the first non-`applied` event only. */
  public setFirstResponse(id: number, occurredAt: string): ApplicationRow {
    this.setFirstResponseStatement.run({ id, occurred_at: occurredAt });
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
