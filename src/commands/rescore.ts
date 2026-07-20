/** Registers offline re-scoring against the current keyword profile. */
import type { Command } from 'commander';

import { RescoreService } from '../services/rescore.js';
import type { CommandContext } from './types.js';

export function register(program: Command, context: CommandContext): void {
  program
    .command('rescore')
    .description('recompute scores for all open jobs without scraping')
    .action(() => rescore(context));
}

function rescore(context: CommandContext): void {
  const spinner = context.ui.spinner('Re-scoring open jobs').start();
  try {
    const service = new RescoreService(context.repos, context.config.loadKeywords());
    const result = service.rescoreOpen();
    spinner.succeed(`Re-scored ${result.updated} open jobs`);
  } catch (error: unknown) {
    spinner.fail('Could not re-score open jobs');
    throw error;
  }
}
