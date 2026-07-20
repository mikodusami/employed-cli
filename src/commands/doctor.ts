/** Registers read-only environment diagnostics. */
import type { Command } from 'commander';

import { DB_PATH } from '../constants.js';
import { DoctorService } from '../services/doctor.js';
import { relativeTime } from '../util/time.js';
import type { CommandContext } from './types.js';

export function register(program: Command, context: CommandContext): void {
  program
    .command('doctor')
    .description('diagnose AI providers and database health')
    .action(async () => inspect(context));
}

async function inspect(context: CommandContext): Promise<void> {
  const result = await new DoctorService(
    context.db,
    context.config.loadApp(),
    DB_PATH,
    context.repos,
  ).inspect();

  context.ui.heading('AI providers');
  if (result.aiDisabled) {
    context.ui.info('AI disabled by config');
  }
  context.ui.table(
    ['Provider', 'Enabled', 'Installed', 'Version / Detail', 'Active'],
    result.providers.map((provider) => [
      provider.name,
      provider.enabled ? 'yes' : 'no',
      provider.installed ? 'yes' : 'no',
      provider.version ?? provider.detail ?? 'unknown',
      provider.active ? '*' : '',
    ]),
  );

  context.ui.heading('Database');
  context.ui.table(
    ['Check', 'Value'],
    [
      ['Path', result.database.path],
      ['Schema version', String(result.database.version)],
      ['Table count', String(result.database.tableCount)],
      ['Integrity', result.database.integrity],
    ],
  );

  context.ui.heading('Last run');
  if (!result.lastRun) {
    context.ui.info('No run has been recorded yet. Run `employed run` to start one.');
    return;
  }
  const { lastRun } = result;
  const duration = lastRun.finishedAt
    ? formatDuration(lastRun.startedAt, lastRun.finishedAt)
    : 'still running or crashed (no finished_at)';
  context.ui.table(
    ['Field', 'Value'],
    [
      ['Started', relativeTime(lastRun.startedAt)],
      ['Duration', duration],
      ['New jobs', String(lastRun.jobsNew)],
      ['Failures', String(lastRun.failures)],
    ],
  );
}

function formatDuration(startedAt: string, finishedAt: string): string {
  const elapsedMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 'unknown';
  }
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}
