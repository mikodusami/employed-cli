/** Registers the human and machine-readable daily new-jobs projection. */
import type { Command } from 'commander';

import type { Band } from '../db/index.js';
import { buildDailyReport } from '../report/build.js';
import { filterReport } from '../report/model.js';
import { renderTerminal } from '../report/render/terminal.js';
import { writeReport } from '../report/writer.js';
import { ValidationError } from '../util/errors.js';
import type { CommandContext } from './types.js';

interface NewOptions {
  band?: string;
  today?: boolean;
  json?: boolean;
}

export function register(program: Command, context: CommandContext): void {
  program
    .command('new')
    .description('show jobs first discovered today and write the daily report')
    .option('--band <bands>', 'comma-separated score bands, for example A,B')
    .option('--today', 'restrict to jobs first discovered today (the current default)')
    .option('--json', 'emit only the serializable report model')
    .action((options: NewOptions) => showNew(context, options));
}

function showNew(context: CommandContext, options: NewOptions): void {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  let report = buildDailyReport(date, { repositories: context.repos, now });
  if (options.band) {
    report = filterReport(report, parseBands(options.band));
  }
  writeReport(report);
  if (options.json) {
    context.ui.output(JSON.stringify(report));
    return;
  }
  renderTerminal(report, context.ui);
}

function parseBands(value: string): Set<Band> {
  const bands = new Set<Band>();
  for (const token of value.split(',')) {
    const band = token.trim().toUpperCase();
    if (!isBand(band)) {
      throw new ValidationError(`Invalid score band: ${token.trim() || '<empty>'}.`);
    }
    bands.add(band);
  }
  return bands;
}

function isBand(value: string): value is Band {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D';
}
