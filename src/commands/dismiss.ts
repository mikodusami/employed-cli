/** Registers dismissal of a scraped job so it stops appearing in future reports. */
import type { Command } from 'commander';

import type { CommandContext } from './types.js';

/** Adds the `dismiss` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('dismiss <jobId>')
    .description('mark a scraped job dismissed so it is excluded from future reports')
    .action((jobIdRaw: string) => dismissJob(context, jobIdRaw));
}

function dismissJob(context: CommandContext, jobIdRaw: string): void {
  const jobId = Number.parseInt(jobIdRaw, 10);
  const job = Number.isInteger(jobId) ? context.repos.jobs.findById(jobId) : undefined;
  if (!job) {
    context.ui.warn(`Job ${jobIdRaw} does not exist.`);
    return;
  }

  context.repos.jobs.dismiss(job.id);
  context.ui.success(`Dismissed: ${job.title}. It will no longer appear in reports.`);
}
