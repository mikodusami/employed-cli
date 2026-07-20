/** Registers promotion of a scraped job into a tracked application. */
import type { Command } from 'commander';

import { ApplicationService } from '../services/application.js';
import { ValidationError } from '../util/errors.js';
import type { CommandContext } from './types.js';

interface ApplyOptions {
  resume?: string;
}

/** Adds the `apply` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('apply <jobId>')
    .description('promote a scraped job into a tracked application')
    .option('--resume <label>', 'résumé version label, e.g. backend-v2')
    .action(async (jobId: string, options: ApplyOptions) => applyToJob(context, jobId, options));
}

async function applyToJob(
  context: CommandContext,
  jobIdRaw: string,
  options: ApplyOptions,
): Promise<void> {
  const jobId = Number.parseInt(jobIdRaw, 10);
  if (!Number.isInteger(jobId)) {
    throw new ValidationError(`Invalid job id: ${jobIdRaw}.`);
  }

  const service = new ApplicationService(context.repos);
  const result = await service.createFromJob(jobId, { resumeVersion: options.resume ?? null });

  const role = result.application.role ?? 'Unknown role';
  const label = `${result.application.company_name} — ${role}`;
  if (result.created) {
    context.ui.success(`Application created: ${label}`);
  } else {
    context.ui.info(`Already applied: ${label} (application ${result.application.id})`);
  }
}
