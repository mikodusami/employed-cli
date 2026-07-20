/** Registers the safe migration path from a Job Search HQ JSON backup. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { KEYWORDS_PATH } from '../constants.js';
import { ImportHqService, type ImportHqSummary } from '../services/import-hq.js';
import { ValidationError } from '../util/errors.js';
import type { CommandContext } from './types.js';

interface ImportHqOptions {
  dryRun?: boolean;
}

export function register(program: Command, context: CommandContext): void {
  program
    .command('import-hq <backup>')
    .description('migrate a Job Search HQ JSON backup without overwriting local records')
    .option('--dry-run', 'show changes without writing anything')
    .action((backup: string, options: ImportHqOptions) => importHq(context, backup, options));
}

function importHq(
  context: CommandContext,
  backup: string,
  options: ImportHqOptions,
): void {
  const filePath = path.resolve(backup);
  const value = readBackup(filePath);
  const service = new ImportHqService({
    repositories: context.repos,
    currentKeywords: context.config.loadKeywords(),
    keywordsPath: KEYWORDS_PATH,
  });
  let summary: ImportHqSummary;
  try {
    summary = service.import(value, { dryRun: options.dryRun });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`HQ backup validation/import failed: ${reason}`, { cause: error });
  }
  renderSummary(context, summary);
}

function readBackup(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`Could not read HQ backup ${filePath}: ${reason}`, { cause: error });
  }
}

function renderSummary(context: CommandContext, summary: ImportHqSummary): void {
  context.ui.heading(summary.dryRun ? 'HQ import dry run' : 'HQ import complete');
  context.ui.table(
    ['Dataset', 'Created', 'Merged', 'Skipped'],
    [
      ['Companies', String(summary.native.companies), '0', 'existing preserved'],
      ['Jobs', String(summary.native.jobs), '0', 'existing preserved'],
      [
        'Applications',
        String(summary.applications.created),
        String(summary.applications.merged),
        String(summary.applications.skipped),
      ],
      ['Email threads', String(summary.threads.created), '0', String(summary.threads.skipped)],
      ['Events', String(summary.eventsCreated), '0', '0'],
      ['Scoring keys', String(summary.scoringKeysAdded), '0', 'existing preserved'],
    ],
  );
}
