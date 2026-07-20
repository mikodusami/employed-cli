/** Registers the read-only application analytics command. */
import type { Command } from 'commander';

import { renderStatsTerminal } from '../report/render/stats-terminal.js';
import { StatsService } from '../services/stats.js';
import type { CommandContext } from './types.js';

interface StatsOptions {
  json?: boolean;
}

/** Adds the `stats` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('stats')
    .description('show application analytics: response/interview rates, trends, and nudges')
    .option('--json', 'emit only the serializable stats model')
    .action((options: StatsOptions) => showStats(context, options));
}

function showStats(context: CommandContext, options: StatsOptions): void {
  const service = new StatsService(context.db, context.config.loadApp().stats);
  const report = service.compute(new Date());

  if (options.json) {
    context.ui.output(JSON.stringify(report));
    return;
  }
  renderStatsTerminal(report, context.ui);
}
