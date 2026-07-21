/** Collects every read-only diagnostic without coupling presentation to probes or SQL. */
import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { ClaudeCodeProvider } from '../ai/providers/claude.js';
import { CodexProvider } from '../ai/providers/codex.js';
import { NodeProcessRunner } from '../ai/process.js';
import type { AiProvider } from '../ai/types.js';
import type { AppConfig, ProviderName } from '../config/schema.js';
import type { Health, Repositories } from '../db/index.js';
import { ScraperConfigSchema } from '../scrape/config.js';
import { EmailService, type EmailStatus } from './email.js';
import { ScheduleService, type ScheduleStatus } from './schedule.js';

export type DiagnosticLevel = 'ok' | 'warning' | 'problem';

export interface ProviderDiagnostic {
  name: ProviderName;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  detail: string | null;
  active: boolean;
  level: DiagnosticLevel;
  fix: string | null;
}

export interface DatabaseDiagnostic {
  path: string;
  version: number;
  tableCount: number;
  integrity: string;
  level: DiagnosticLevel;
  fix: string | null;
}

export interface LastRunDiagnostic {
  startedAt: string;
  finishedAt: string | null;
  jobsNew: number;
  failures: number;
  level: DiagnosticLevel;
  fix: string | null;
}

export interface GmailDiagnostic {
  provider: ProviderName | null;
  level: DiagnosticLevel;
  detail: string;
  fix: string | null;
}

export interface EmailDiagnostic extends EmailStatus {
  enabled: boolean;
  level: DiagnosticLevel;
  fix: string | null;
}

export interface FleetIssue {
  company: string;
  health: Health;
  lastSuccess: string | null;
  consecutiveFailures: number;
  confidence: number | null;
  level: DiagnosticLevel;
  fix: string;
}

export interface FleetDiagnostic {
  counts: Record<Health, number>;
  issues: readonly FleetIssue[];
}

export interface DoctorResult {
  aiDisabled: boolean;
  providers: readonly ProviderDiagnostic[];
  gmail: GmailDiagnostic;
  email: EmailDiagnostic;
  fleet: FleetDiagnostic;
  database: DatabaseDiagnostic;
  lastRun: LastRunDiagnostic | null;
  scheduler: ScheduleStatus & { level: DiagnosticLevel; fix: string | null };
  problemCount: number;
}

interface EmailVerifier {
  verify(): Promise<EmailStatus>;
}

export interface DoctorServiceOptions {
  providers?: ReadonlyMap<ProviderName, AiProvider>;
  createEmailVerifier?: () => EmailVerifier;
  scheduleService?: Pick<ScheduleService, 'status'>;
  homeDirectory?: string;
}

export class DoctorService {
  private readonly options: DoctorServiceOptions;

  public constructor(
    private readonly database: Database.Database,
    private readonly config: AppConfig,
    private readonly databasePath: string,
    private readonly repositories: Repositories,
    options: DoctorServiceOptions = {},
  ) {
    this.options = options;
  }

  public async inspect(): Promise<DoctorResult> {
    const providers = this.options.providers ?? defaultProviders();
    const providerDiagnostics = await this.inspectProviders(providers);
    const active = providerDiagnostics.find((provider) => provider.active)?.name ?? null;
    const result = {
      aiDisabled: !this.config.ai.enabled,
      providers: providerDiagnostics,
      gmail: this.inspectGmail(active),
      email: await this.inspectEmail(),
      fleet: this.inspectFleet(),
      database: this.inspectDatabase(),
      lastRun: this.inspectLastRun(),
      scheduler: this.inspectScheduler(),
    };
    return { ...result, problemCount: countProblems(result) };
  }

  private async inspectProviders(
    providers: ReadonlyMap<ProviderName, AiProvider>,
  ): Promise<readonly ProviderDiagnostic[]> {
    const statuses = await Promise.all(
      [...providers].map(async ([name, provider]) => ({
        name,
        status: await provider.isAvailable(),
      })),
    );
    const available = new Set(
      statuses.filter(({ status }) => status.available).map(({ name }) => name),
    );
    const active = this.config.ai.enabled
      ? (this.config.ai.preference.find(
          (name) => this.config.ai.providers[name].enabled && available.has(name),
        ) ?? null)
      : null;
    return statuses.map(({ name, status }) => {
      const enabled = this.config.ai.enabled && this.config.ai.providers[name].enabled;
      const level = enabled && !status.available ? 'problem' : enabled ? 'ok' : 'warning';
      return {
        name,
        enabled,
        installed: status.available,
        version: status.version,
        detail: status.detail,
        active: name === active,
        level,
        fix: enabled && !status.available ? providerInstallFix(name) : null,
      };
    });
  }

  private inspectGmail(active: ProviderName | null): GmailDiagnostic {
    if (!this.config.ai.enabled) {
      return {
        provider: null,
        level: 'warning',
        detail: 'AI is disabled; Gmail sync is unavailable.',
        fix: 'Set ai.enabled: true, then configure Gmail MCP for an enabled provider.',
      };
    }
    if (!active) {
      return {
        provider: null,
        level: 'problem',
        detail: 'No active AI provider can access Gmail MCP.',
        fix: 'Install an enabled AI CLI, then run `employed doctor` again.',
      };
    }
    const home = this.options.homeDirectory ?? homedir();
    const paths = gmailConfigPaths(active, home);
    const configured = paths.some((filePath) => fileContainsGmail(filePath));
    return configured
      ? {
          provider: active,
          level: 'ok',
          detail: `Gmail MCP appears in ${active} configuration.`,
          fix: null,
        }
      : {
          provider: active,
          level: 'problem',
          detail: `Gmail MCP was not found in ${active} configuration.`,
          fix: gmailSetupFix(active),
        };
  }

  private async inspectEmail(): Promise<EmailDiagnostic> {
    if (!this.config.email.enabled) {
      return {
        enabled: false,
        reachable: false,
        detail: 'SMTP delivery is disabled by config.',
        level: 'warning',
        fix: 'Set email.enabled: true and export EMPLOYED_SMTP_PASSWORD.',
      };
    }
    try {
      const verifier =
        this.options.createEmailVerifier?.() ?? new EmailService(this.config.email);
      const status = await verifier.verify();
      return {
        enabled: true,
        ...status,
        level: status.reachable ? 'ok' : 'problem',
        fix: status.reachable
          ? null
          : 'Check email.smtp settings and EMPLOYED_SMTP_PASSWORD, then rerun doctor.',
      };
    } catch (error: unknown) {
      return {
        enabled: true,
        reachable: false,
        detail: error instanceof Error ? error.message : String(error),
        level: 'problem',
        fix: 'Set EMPLOYED_SMTP_PASSWORD and verify email.smtp settings.',
      };
    }
  }

  private inspectFleet(): FleetDiagnostic {
    const counts: Record<Health, number> = {
      ok: 0,
      degraded: 0,
      broken: 0,
      'manual-review': 0,
      untested: 0,
    };
    const issues: FleetIssue[] = [];
    for (const company of this.repositories.companies.list()) {
      counts[company.health] += 1;
      const confidence = generatedConfidence(company.scraper_config);
      const isLowConfidence = confidence !== null && confidence < 0.6;
      if (company.health === 'ok' && !isLowConfidence) {
        continue;
      }
      const level = ['broken', 'manual-review'].includes(company.health) ? 'problem' : 'warning';
      issues.push({
        company: company.name,
        health: company.health,
        lastSuccess: company.last_success,
        consecutiveFailures: company.consecutive_failures,
        confidence,
        level,
        fix: `Run \`employed company generate "${company.name}"\` and then scan it.`,
      });
    }
    return { counts, issues };
  }

  private inspectLastRun(): LastRunDiagnostic | null {
    const run = this.repositories.runs.latest();
    if (!run) {
      return null;
    }
    const incomplete = run.finished_at === null;
    return {
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      jobsNew: run.jobs_new ?? 0,
      failures: countFailures(run.failures),
      level: incomplete ? 'problem' : countFailures(run.failures) > 0 ? 'warning' : 'ok',
      fix: incomplete
        ? 'Inspect logs, remove a stale run lock if needed, then run `employed run`.'
        : null,
    };
  }

  private inspectDatabase(): DatabaseDiagnostic {
    const tableCount = this.database
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' " +
          "AND name NOT LIKE 'sqlite_%'",
      )
      .get()?.count;
    const integrity = this.database.pragma('integrity_check', { simple: true }) as string;
    const version = this.database.pragma('user_version', { simple: true }) as number;
    const healthy = integrity === 'ok';
    return {
      path: this.databasePath,
      version,
      tableCount: tableCount ?? 0,
      integrity,
      level: healthy ? 'ok' : 'problem',
      fix: healthy
        ? null
        : 'Back up ~/.employed, then run `sqlite3 employed.db "PRAGMA integrity_check"`.',
    };
  }

  private inspectScheduler(): DoctorResult['scheduler'] {
    try {
      const status = (this.options.scheduleService ?? new ScheduleService()).status();
      return {
        ...status,
        level: status.installed ? 'ok' : 'warning',
        fix: status.installed
          ? null
          : `Run \`employed schedule install --at ${this.config.run.time}\`.`,
      };
    } catch (error: unknown) {
      return {
        installed: false,
        path: 'unavailable',
        time: null,
        nextRun: null,
        level: 'problem',
        fix: `Scheduler check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

function defaultProviders(): ReadonlyMap<ProviderName, AiProvider> {
  const processes = new NodeProcessRunner();
  return new Map<ProviderName, AiProvider>([
    ['claude', new ClaudeCodeProvider(processes)],
    ['codex', new CodexProvider(processes)],
  ]);
}

function providerInstallFix(provider: ProviderName): string {
  return provider === 'claude'
    ? 'Install Claude Code and ensure `claude` is on PATH.'
    : 'Install Codex CLI and ensure `codex` is on PATH.';
}

function gmailConfigPaths(provider: ProviderName, home: string): readonly string[] {
  return provider === 'claude'
    ? [path.join(home, '.claude.json'), path.join(home, '.claude', 'settings.json')]
    : [path.join(home, '.codex', 'config.toml')];
}

function fileContainsGmail(filePath: string): boolean {
  try {
    return existsSync(filePath) && /gmail/i.test(readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }
}

function gmailSetupFix(provider: ProviderName): string {
  return provider === 'claude'
    ? 'Run `claude mcp add gmail -- <YOUR_GMAIL_MCP_COMMAND>`, then authenticate it.'
    : 'Add `[mcp_servers.gmail]` with its command to ~/.codex/config.toml, then authenticate it.';
}

function generatedConfidence(value: string | null): number | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = ScraperConfigSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data.confidence : null;
  } catch {
    return null;
  }
}

function countFailures(value: string | null): number {
  if (!value) {
    return 0;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 1;
  } catch {
    return 1;
  }
}

function countProblems(result: Omit<DoctorResult, 'problemCount'>): number {
  return (
    result.providers.filter((provider) => provider.level === 'problem').length +
    Number(result.gmail.level === 'problem') +
    Number(result.email.level === 'problem') +
    result.fleet.issues.filter((issue) => issue.level === 'problem').length +
    Number(result.database.level === 'problem') +
    Number(result.lastRun?.level === 'problem') +
    Number(result.scheduler.level === 'problem')
  );
}
