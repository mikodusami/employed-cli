/** Registers the safety valve that un-excludes one system auto-filtered job. */
import type { Command } from 'commander';

import type { CommandContext } from './types.js';

/** Adds the `restore` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('restore <jobId>')
    .description('reopen one auto-filtered job (does not affect a manual dismiss)')
    .action((jobIdRaw: string) => restoreJob(context, jobIdRaw));
}

function restoreJob(context: CommandContext, jobIdRaw: string): void {
  const jobId = Number.parseInt(jobIdRaw, 10);
  const job = Number.isInteger(jobId) ? context.repos.jobs.findById(jobId) : undefined;
  if (!job) {
    context.ui.warn(`Job ${jobIdRaw} does not exist.`);
    return;
  }
  if (job.filter_reason === null) {
    context.ui.warn(
      job.status === 'dismissed'
        ? `Job ${jobId} was dismissed manually, not auto-filtered — nothing to restore.`
        : `Job ${jobId} was never auto-filtered — nothing to restore.`,
    );
    return;
  }

  const restored = context.repos.jobs.restore(job.id);
  context.ui.success(
    `Restored: ${restored.title}. It will appear in reports again (was: ${job.filter_reason}).`,
  );
}
