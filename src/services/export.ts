/** Versioned, lossless JSON and spreadsheet-friendly CSV exports. */
import type {
  ApplicationRow,
  CompanyRow,
  EventRow,
  JobRow,
  Repositories,
} from '../db/index.js';

export interface EmployedExport {
  version: 1;
  exportedAt: string;
  companies: readonly CompanyRow[];
  jobs: readonly JobRow[];
  applications: readonly ApplicationRow[];
  events: readonly EventRow[];
}

export type ExportKind = 'applications' | 'jobs';

export class ExportService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public exportJson(): EmployedExport {
    return {
      version: 1,
      exportedAt: this.now().toISOString(),
      companies: this.repositories.companies.list(),
      jobs: this.repositories.jobs.list(),
      applications: this.repositories.applications.list(),
      events: this.repositories.events.list(),
    };
  }

  public exportCsv(kind: ExportKind): string {
    return kind === 'applications' ? this.applicationsCsv() : this.jobsCsv();
  }

  private applicationsCsv(): string {
    const headers = [
      'id',
      'job_id',
      'company_name',
      'role',
      'status',
      'applied_at',
      'resume_version',
      'notes',
      'first_response_at',
      'last_activity_at',
      'created_at',
    ];
    const rows = this.repositories.applications.list().map((application) => [
      application.id,
      application.job_id,
      application.company_name,
      application.role,
      application.status,
      application.applied_at,
      application.resume_version,
      application.notes,
      application.first_response_at,
      application.last_activity_at,
      application.created_at,
    ]);
    return csv(headers, rows);
  }

  private jobsCsv(): string {
    const headers = [
      'id',
      'company_id',
      'title',
      'url',
      'location',
      'department',
      'score',
      'band',
      'status',
      'first_seen',
      'last_seen',
      'matched_kw',
    ];
    const rows = this.repositories.jobs.list().map((job) => [
      job.id,
      job.company_id,
      job.title,
      job.url,
      job.location,
      job.department,
      job.score,
      job.band,
      job.status,
      job.first_seen,
      job.last_seen,
      job.matched_kw,
    ]);
    return csv(headers, rows);
  }
}

type CsvValue = string | number | null;

function csv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(row.map((value) => escapeCsv(value ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
