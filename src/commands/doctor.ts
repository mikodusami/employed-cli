/** Registers comprehensive, read-only environment diagnostics. */
import type { Command } from 'commander';

import { DB_PATH } from '../constants.js';
import {
  DoctorService,
  type DiagnosticLevel,
  type DoctorResult,
} from '../services/doctor.js';
import { relativeTime } from '../util/time.js';
import type { CommandContext } from './types.js';

interface DoctorOptions {
  strict?: boolean;
}

export function register(program: Command, context: CommandContext): void {
  program
    .command('doctor')
    .description('diagnose providers, delivery, scrapers, database, run, and scheduler health')
    .option('--strict', 'exit nonzero when a red problem is found')
    .action(async (options: DoctorOptions) => inspect(context, options));
}

async function inspect(context: CommandContext, options: DoctorOptions): Promise<void> {
  const result = await new DoctorService(
    context.db,
    context.config.loadApp(),
    DB_PATH,
    context.repos,
  ).inspect();

  renderProviders(context, result);
  renderGmail(context, result);
  renderEmail(context, result);
  renderFleet(context, result);
  renderDatabase(context, result);
  renderLastRun(context, result);
  renderScheduler(context, result);

  if (options.strict && result.problemCount > 0) {
    process.exitCode = 1;
  }
}

function renderProviders(context: CommandContext, result: DoctorResult): void {
  context.ui.heading('AI providers');
  if (result.aiDisabled) {
    context.ui.warn('AI disabled by config. Fix: set ai.enabled: true to use AI features.');
  }
  context.ui.table(
    ['Status', 'Provider', 'Enabled', 'Installed', 'Version / Detail', 'Active', 'Fix'],
    result.providers.map((provider) => [
      marker(provider.level),
      provider.name,
      provider.enabled ? 'yes' : 'no',
      provider.installed ? 'yes' : 'no',
      provider.version ?? provider.detail ?? 'unknown',
      provider.active ? '*' : '',
      provider.fix ?? '—',
    ]),
  );
}

function renderGmail(context: CommandContext, result: DoctorResult): void {
  context.ui.heading('Gmail MCP');
  const gmail = result.gmail;
  context.ui.table(
    ['Status', 'Provider', 'Detail', 'Fix'],
    [[marker(gmail.level), gmail.provider ?? 'none', gmail.detail, gmail.fix ?? '—']],
  );
}

function renderEmail(context: CommandContext, result: DoctorResult): void {
  context.ui.heading('Email / SMTP');
  const email = result.email;
  context.ui.table(
    ['Status', 'Enabled', 'Reachable', 'Detail', 'Fix'],
    [
      [
        marker(email.level),
        email.enabled ? 'yes' : 'no',
        email.enabled ? (email.reachable ? 'yes' : 'no') : 'not checked',
        email.detail,
        email.fix ?? '—',
      ],
    ],
  );
}

function renderFleet(context: CommandContext, result: DoctorResult): void {
  context.ui.heading('Company fleet health');
  const counts = result.fleet.counts;
  context.ui.table(
    ['Health', 'Count'],
    (['ok', 'degraded', 'broken', 'manual-review', 'untested'] as const).map((health) => [
      health,
      String(counts[health]),
    ]),
  );
  if (result.fleet.issues.length === 0) {
    context.ui.success('Every configured company is healthy.');
    return;
  }
  context.ui.table(
    ['Status', 'Company', 'Health', 'Last success', 'Failures', 'Confidence', 'Fix'],
    result.fleet.issues.map((issue) => [
      marker(issue.level),
      issue.company,
      issue.health,
      issue.lastSuccess ? relativeTime(issue.lastSuccess) : 'never',
      String(issue.consecutiveFailures),
      issue.confidence === null ? '—' : issue.confidence.toFixed(2),
      issue.fix,
    ]),
  );
}

function renderDatabase(context: CommandContext, result: DoctorResult): void {
  context.ui.heading('Database');
  const database = result.database;
  context.ui.table(
    ['Status', 'Check', 'Value', 'Fix'],
    [
      [marker(database.level), 'Path', database.path, database.fix ?? '—'],
      [marker(database.level), 'Schema version', String(database.version), '—'],
      [marker(database.level), 'Table count', String(database.tableCount), '—'],
      [marker(database.level), 'Integrity', database.integrity, database.fix ?? '—'],
    ],
  );
}

function renderLastRun(context: CommandContext, result: DoctorResult): void {
  context.ui.heading('Last run');
  if (!result.lastRun) {
    context.ui.warn('No run recorded. Fix: run `employed run`.');
    return;
  }
  const lastRun = result.lastRun;
  const duration = lastRun.finishedAt
    ? formatDuration(lastRun.startedAt, lastRun.finishedAt)
    : 'incomplete (no finished_at)';
  context.ui.table(
    ['Status', 'Started', 'Duration', 'New jobs', 'Failures', 'Fix'],
    [
      [
        marker(lastRun.level),
        relativeTime(lastRun.startedAt),
        duration,
        String(lastRun.jobsNew),
        String(lastRun.failures),
        lastRun.fix ?? '—',
      ],
    ],
  );
}

function renderScheduler(context: CommandContext, result: DoctorResult): void {
  context.ui.heading('Scheduler');
  const scheduler = result.scheduler;
  context.ui.table(
    ['Status', 'Installed', 'Time', 'Next run', 'Path', 'Fix'],
    [
      [
        marker(scheduler.level),
        scheduler.installed ? 'yes' : 'no',
        scheduler.time ?? '—',
        scheduler.nextRun ? relativeTime(scheduler.nextRun) : '—',
        scheduler.path,
        scheduler.fix ?? '—',
      ],
    ],
  );
}

function marker(level: DiagnosticLevel): string {
  if (level === 'ok') {
    return 'OK';
  }
  return level === 'warning' ? 'WARN' : 'PROBLEM';
}

function formatDuration(startedAt: string, finishedAt: string): string {
  const elapsedMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 'unknown';
  }
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}
