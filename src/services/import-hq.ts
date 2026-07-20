/** Lenient, idempotent migration from the legacy Job Search HQ backup shape. */
import { writeFileSync } from 'node:fs';

import { stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import type { KeywordsFile } from '../config/schema.js';
import type { AppStatus, EventType, Repositories } from '../db/index.js';

const StatusSchema = z.enum(['saved', 'applied', 'oa', 'interview', 'offer', 'rejected']);
const HqApplicationSchema = z
  .object({
    company: z.string().trim().min(1).optional(),
    company_name: z.string().trim().min(1).optional(),
    role: z.string().trim().nullable().optional(),
    title: z.string().trim().nullable().optional(),
    status: StatusSchema.default('applied'),
    appliedAt: z.string().nullable().optional(),
    applied_at: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    resumeVersion: z.string().nullable().optional(),
    resume_version: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .passthrough()
  .refine((app) => Boolean(app.company ?? app.company_name), 'company is required');
const SeenSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      threadId: z.string().trim().min(1).optional(),
      thread_id: z.string().trim().min(1).optional(),
      id: z.string().trim().min(1).optional(),
      classifiedAs: z.string().nullable().optional(),
      classified_as: z.string().nullable().optional(),
      processedAt: z.string().optional(),
      processed_at: z.string().optional(),
    })
    .passthrough()
    .refine((item) => Boolean(item.threadId ?? item.thread_id ?? item.id), 'thread id is required'),
]);
const WeightsSchema = z.record(z.string(), z.number()).default({});
const HqBackupSchema = z
  .object({
    apps: z.array(HqApplicationSchema).default([]),
    scoring: z
      .object({
        title: WeightsSchema,
        desc: WeightsSchema.optional(),
        description: WeightsSchema.optional(),
        negative: WeightsSchema,
      })
      .partial()
      .default({}),
    seen: z.array(SeenSchema).default([]),
  })
  .passthrough();
const CompanyRowSchema = z.object({
  id: z.number().int(), name: z.string(), slug: z.string().nullable(), careers_url: z.string(),
  tier: z.enum(['A', 'B', 'C']),
  scrape_method: z.enum([
    'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'recruitee',
    'generated-static', 'generated-playwright', 'unknown', 'manual',
  ]),
  scraper_config: z.string().nullable(), health: z.enum(['ok', 'degraded', 'broken', 'untested']),
  consecutive_failures: z.number().int(), last_success: z.string().nullable(),
  last_yield: z.number().int().nullable(), created_at: z.string(),
});
const JobRowSchema = z.object({
  id: z.number().int(), company_id: z.number().int(), dedupe_key: z.string(), title: z.string(),
  url: z.string(), location: z.string().nullable(), department: z.string().nullable(),
  description: z.string().nullable(), score: z.number().int().nullable(),
  band: z.enum(['A', 'B', 'C', 'D']).nullable(), matched_kw: z.string().nullable(),
  status: z.enum(['open', 'closed', 'dismissed']), first_seen: z.string(), last_seen: z.string(),
});
const ApplicationRowSchema = z.object({
  id: z.number().int(), job_id: z.number().int().nullable(), company_name: z.string(),
  role: z.string().nullable(), status: StatusSchema, applied_at: z.string().nullable(),
  resume_version: z.string().nullable(), notes: z.string().nullable(),
  first_response_at: z.string().nullable(), last_activity_at: z.string().nullable(),
  created_at: z.string(),
});
const EventRowSchema = z.object({
  id: z.number().int(), application_id: z.number().int(), at: z.string(),
  type: z.enum(['applied', 'oa', 'interview', 'offer', 'rejected', 'note', 'email']),
  note: z.string().nullable(),
});
const NativeSnapshotSchema = z.object({
  version: z.literal(1), exportedAt: z.string(), companies: z.array(CompanyRowSchema),
  jobs: z.array(JobRowSchema), applications: z.array(ApplicationRowSchema),
  events: z.array(EventRowSchema),
});

export type HqBackup = z.infer<typeof HqBackupSchema>;

export interface ImportHqSummary {
  dryRun: boolean;
  applications: { created: number; merged: number; skipped: number };
  eventsCreated: number;
  threads: { created: number; skipped: number };
  scoringKeysAdded: number;
  native: { companies: number; jobs: number };
}

export interface ImportHqOptions {
  dryRun?: boolean;
}

export interface ImportHqDependencies {
  repositories: Repositories;
  currentKeywords: KeywordsFile;
  keywordsPath: string;
  now?: () => Date;
}

export class ImportHqService {
  private readonly now: () => Date;

  public constructor(private readonly dependencies: ImportHqDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public parse(value: unknown): HqBackup {
    return HqBackupSchema.parse(value);
  }

  public import(value: unknown, options: ImportHqOptions = {}): ImportHqSummary {
    const native = NativeSnapshotSchema.safeParse(value);
    if (native.success) {
      return this.importNative(native.data, Boolean(options.dryRun));
    }
    const backup = this.parse(value);
    const plan = this.plan(backup, Boolean(options.dryRun));
    if (options.dryRun) {
      return plan.summary;
    }
    return this.dependencies.repositories.withTransaction(() => {
      this.applyApplications(plan.applications);
      this.applySeen(plan.seen);
      if (plan.summary.scoringKeysAdded > 0) {
        writeFileSync(
          this.dependencies.keywordsPath,
          stringifyYaml(plan.keywords, { lineWidth: 0 }),
          'utf8',
        );
      }
      return plan.summary;
    });
  }

  private importNative(
    snapshot: z.infer<typeof NativeSnapshotSchema>,
    dryRun: boolean,
  ): ImportHqSummary {
    const existingCompanies = new Set(
      this.dependencies.repositories.companies.list().map((row) => row.id),
    );
    const existingJobs = new Set(this.dependencies.repositories.jobs.list().map((row) => row.id));
    const existingApplications = new Set(
      this.dependencies.repositories.applications.list().map((row) => row.id),
    );
    const existingEvents = new Set(
      this.dependencies.repositories.events.list().map((row) => row.id),
    );
    const summary: ImportHqSummary = {
      dryRun,
      native: {
        companies: snapshot.companies.filter((row) => !existingCompanies.has(row.id)).length,
        jobs: snapshot.jobs.filter((row) => !existingJobs.has(row.id)).length,
      },
      applications: {
        created: snapshot.applications.filter((row) => !existingApplications.has(row.id)).length,
        merged: 0,
        skipped: snapshot.applications.filter((row) => existingApplications.has(row.id)).length,
      },
      eventsCreated: snapshot.events.filter((row) => !existingEvents.has(row.id)).length,
      threads: { created: 0, skipped: 0 }, scoringKeysAdded: 0,
    };
    if (!dryRun) {
      this.dependencies.repositories.restoreSnapshot(snapshot);
    }
    return summary;
  }

  private plan(backup: HqBackup, dryRun: boolean): ImportPlan {
    const applications = uniqueBy(
      backup.apps.map((application) => normalizeApplication(application)),
      (application) =>
        `${application.company.toLowerCase()}\0${application.role?.toLowerCase() ?? ''}`,
    );
    const newApplications = applications.filter(
      (application) =>
        !this.dependencies.repositories.applications.findByCompanyRole(
          application.company,
          application.role,
        ),
    );
    const seen = uniqueBy(backup.seen.map(normalizeSeen), (item) => item.threadId);
    const newSeen = seen.filter(
      (item) => !this.dependencies.repositories.emailThreads.isSeen(item.threadId),
    );
    const keywords = mergeKeywords(this.dependencies.currentKeywords, backup.scoring);
    return {
      applications: newApplications,
      seen: newSeen,
      keywords: keywords.value,
      summary: {
        dryRun,
        native: { companies: 0, jobs: 0 },
        applications: {
          created: newApplications.length,
          merged: 0,
          skipped: applications.length - newApplications.length,
        },
        eventsCreated: newApplications.reduce(
          (count, application) => count + (application.status === 'applied' ? 1 : 2),
          0,
        ),
        threads: { created: newSeen.length, skipped: seen.length - newSeen.length },
        scoringKeysAdded: keywords.added,
      },
    };
  }

  private applyApplications(applications: readonly NormalizedApplication[]): void {
    for (const input of applications) {
      const createdAt = input.createdAt ?? this.now().toISOString();
      const appliedAt = input.appliedAt ?? createdAt;
      const application = this.dependencies.repositories.applications.create(
        {
          company_name: input.company,
          role: input.role,
          status: input.status,
          applied_at: appliedAt,
          resume_version: input.resumeVersion,
          notes: input.notes,
        },
        createdAt,
      );
      this.dependencies.repositories.events.append({
        application_id: application.id,
        at: appliedAt,
        type: 'applied',
        note: 'Imported from Job Search HQ.',
      });
      if (input.status !== 'applied') {
        this.dependencies.repositories.events.append({
          application_id: application.id,
          at: createdAt,
          type: statusEvent(input.status),
          note: `Imported current status "${input.status}" from Job Search HQ.`,
        });
        this.dependencies.repositories.applications.touchActivity(application.id, createdAt);
        this.dependencies.repositories.applications.setFirstResponse(application.id, createdAt);
      }
    }
  }

  private applySeen(items: readonly NormalizedSeen[]): void {
    for (const item of items) {
      this.dependencies.repositories.emailThreads.markProcessed({
        thread_id: item.threadId,
        classified_as: item.classifiedAs,
        processed_at: item.processedAt ?? this.now().toISOString(),
      });
    }
  }
}

interface NormalizedApplication {
  company: string;
  role: string | null;
  status: AppStatus;
  appliedAt: string | null;
  createdAt: string | null;
  resumeVersion: string | null;
  notes: string | null;
}

interface NormalizedSeen {
  threadId: string;
  classifiedAs: string | null;
  processedAt: string | null;
}

interface ImportPlan {
  applications: readonly NormalizedApplication[];
  seen: readonly NormalizedSeen[];
  keywords: KeywordsFile;
  summary: ImportHqSummary;
}

function normalizeApplication(input: z.infer<typeof HqApplicationSchema>): NormalizedApplication {
  return {
    company: input.company ?? input.company_name ?? '',
    role: input.role ?? input.title ?? null,
    status: input.status,
    appliedAt: input.appliedAt ?? input.applied_at ?? null,
    createdAt: input.createdAt ?? input.created_at ?? null,
    resumeVersion: input.resumeVersion ?? input.resume_version ?? null,
    notes: input.notes ?? null,
  };
}

function normalizeSeen(input: z.infer<typeof SeenSchema>): NormalizedSeen {
  if (typeof input === 'string') {
    return { threadId: input, classifiedAs: null, processedAt: null };
  }
  return {
    threadId: input.threadId ?? input.thread_id ?? input.id ?? '',
    classifiedAs: input.classifiedAs ?? input.classified_as ?? null,
    processedAt: input.processedAt ?? input.processed_at ?? null,
  };
}

function mergeKeywords(
  current: KeywordsFile,
  scoring: HqBackup['scoring'],
): { value: KeywordsFile; added: number } {
  const incoming: KeywordsFile = {
    title: scoring.title ?? {},
    description: scoring.description ?? scoring.desc ?? {},
    negative: scoring.negative ?? {},
  };
  let added = 0;
  const value: KeywordsFile = {
    title: { ...current.title },
    description: { ...current.description },
    negative: { ...current.negative },
  };
  for (const group of ['title', 'description', 'negative'] as const) {
    for (const [keyword, weight] of Object.entries(incoming[group])) {
      if (!(keyword in value[group])) {
        value[group][keyword] = weight;
        added += 1;
      }
    }
  }
  return { value, added };
}

function statusEvent(status: AppStatus): EventType {
  return status === 'saved' ? 'note' : status;
}

function uniqueBy<Value>(values: readonly Value[], key: (value: Value) => string): Value[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}
