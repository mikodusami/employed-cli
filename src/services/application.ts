/**
 * The single chokepoint for every application status change (§5 append-only audit discipline).
 *
 * @remarks `transition` is the only code path allowed to change `applications.status` — used by
 * `move`, by `SyncService`, and indirectly by `apply`'s creation path. Every status change appends
 * a matching event, so `applications.status` remains a cache of "the latest event," never a
 * standalone source of truth. If a future code path sets status without going through here, the
 * audit log develops holes and a future `stats` feature would silently lie.
 */
import type { ApplicationFilter } from '../db/repositories/applications.js';
import type { AppStatus, ApplicationRow, EventRow, EventType, Repositories } from '../db/index.js';
import { ValidationError } from '../util/errors.js';

/**
 * Expected next statuses per current status — advisory, not restrictive. Real job searches are
 * messy (a recruiter can revive a dead thread), so a transition outside this map is warned about,
 * never blocked.
 */
const EXPECTED_TRANSITIONS: Readonly<Record<AppStatus, readonly AppStatus[]>> = {
  saved: ['applied'],
  applied: ['oa', 'interview', 'offer', 'rejected'],
  oa: ['interview', 'offer', 'rejected'],
  interview: ['interview', 'offer', 'rejected'],
  offer: ['rejected'],
  rejected: [],
};

export interface CreateFromJobOptions {
  resumeVersion?: string | null;
}

export interface CreateFromJobResult {
  application: ApplicationRow;
  /** False when an application already existed for this job — `apply` is idempotent. */
  created: boolean;
}

export interface CreateManualInput {
  company: string;
  role?: string | null;
  status?: AppStatus;
  note?: string | null;
}

export interface TransitionResult {
  application: ApplicationRow;
  /** Set when `to` was not an expected next status for the application's prior status. */
  warning: string | null;
}

export interface ApplicationDetail {
  application: ApplicationRow;
  events: readonly EventRow[];
}

/** Maps a status to the event type recorded for reaching it (the two enums overlap by name). */
function statusToEventType(status: AppStatus): EventType {
  return status === 'saved' ? 'note' : status;
}

export class ApplicationService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Promotes a scraped job into a tracked application; idempotent per job. */
  public async createFromJob(
    jobId: number,
    options: CreateFromJobOptions = {},
  ): Promise<CreateFromJobResult> {
    const existing = this.repositories.applications.findByJobId(jobId);
    if (existing) {
      return { application: existing, created: false };
    }

    const job = this.repositories.jobs.findById(jobId);
    if (!job) {
      throw new ValidationError(`Job ${jobId} does not exist.`);
    }
    const company = this.repositories.companies.findById(job.company_id);
    const occurredAt = this.now().toISOString();
    const application = this.repositories.applications.create(
      {
        job_id: jobId,
        company_name: company?.name ?? 'Unknown company',
        role: job.title,
        status: 'applied',
        applied_at: occurredAt,
        resume_version: options.resumeVersion ?? null,
      },
      occurredAt,
    );
    this.repositories.events.append({
      application_id: application.id,
      at: occurredAt,
      type: 'applied',
      note: null,
    });
    return { application, created: true };
  }

  /** Creates an application with no scraped job (Gmail-discovered, or applied off-platform). */
  public async createManual(input: CreateManualInput): Promise<ApplicationRow> {
    const status = input.status ?? 'applied';
    const occurredAt = this.now().toISOString();
    const application = this.repositories.applications.create(
      {
        company_name: input.company,
        role: input.role ?? null,
        status,
        applied_at: status === 'applied' ? occurredAt : null,
      },
      occurredAt,
    );
    this.repositories.events.append({
      application_id: application.id,
      at: occurredAt,
      type: statusToEventType(status),
      note: input.note ?? null,
    });
    return application;
  }

  /** The single chokepoint for status change; always appends an event and touches activity. */
  public async transition(
    id: number,
    to: AppStatus,
    options: { note?: string | null } = {},
  ): Promise<TransitionResult> {
    const current = this.repositories.applications.findById(id);
    if (!current) {
      throw new ValidationError(`Application ${id} does not exist.`);
    }

    const expected = EXPECTED_TRANSITIONS[current.status] ?? [];
    const warning = expected.includes(to)
      ? null
      : `Unusual transition: ${current.status} → ${to}.`;

    const occurredAt = this.now().toISOString();
    this.repositories.applications.updateStatus(id, to);
    this.repositories.applications.touchActivity(id, occurredAt);
    if (to !== 'applied') {
      this.repositories.applications.setFirstResponse(id, occurredAt);
    }
    this.repositories.events.append({
      application_id: id,
      at: occurredAt,
      type: statusToEventType(to),
      note: options.note ?? null,
    });

    const application = this.repositories.applications.findById(id);
    if (!application) {
      throw new Error(`Application ${id} vanished mid-transition.`);
    }
    return { application, warning };
  }

  /** Appends a `note` event without changing status. */
  public async addNote(id: number, text: string): Promise<void> {
    if (!this.repositories.applications.findById(id)) {
      throw new ValidationError(`Application ${id} does not exist.`);
    }
    const occurredAt = this.now().toISOString();
    this.repositories.events.append({
      application_id: id,
      at: occurredAt,
      type: 'note',
      note: text,
    });
    this.repositories.applications.touchActivity(id, occurredAt);
  }

  public list(filter: ApplicationFilter = {}): readonly ApplicationRow[] {
    return this.repositories.applications.list(filter);
  }

  public detail(id: number): ApplicationDetail {
    const application = this.repositories.applications.findById(id);
    if (!application) {
      throw new ValidationError(`Application ${id} does not exist.`);
    }
    return { application, events: this.repositories.events.listForApplication(id) };
  }
}
