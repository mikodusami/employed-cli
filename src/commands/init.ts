/** Registers the idempotent first-run initialization command. */
import type { Command } from 'commander';

import { ScaffoldService } from '../config/index.js';
import { EMPLOYED_DIR } from '../constants.js';
import { getDatabaseVersion } from '../db/index.js';
import type { UI } from '../ui/index.js';
import type { CommandContext } from './types.js';

/** Adds the init command to the root CLI program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('init')
    .description('create and validate the employed workspace')
    .action(() => initialize(context));
}

function initialize(context: CommandContext): void {
  context.ui.banner();

  const scaffold = runStep(
    context.ui,
    'Creating employed workspace',
    'Workspace structure is ready',
    () => new ScaffoldService(EMPLOYED_DIR).initialize(),
  );

  runStep(context.ui, 'Validating configuration', 'Configuration is valid', () => {
    context.config.loadApp();
    context.config.loadCompanies();
    context.config.loadKeywords();
  });

  runStep(
    context.ui,
    'Migrating SQLite database',
    (databaseVersion) => `Database schema is at version ${databaseVersion}`,
    () => getDatabaseVersion(context.db),
  );

  if (scaffold.created.length === 0) {
    context.ui.info('employed is already initialized; no files were changed.');
    return;
  }

  context.ui.success(`Created: ${scaffold.created.join(', ')}`);
  if (scaffold.skipped.length > 0) {
    context.ui.info(`Preserved: ${scaffold.skipped.join(', ')}`);
  }
}

function runStep<Result>(
  ui: UI,
  label: string,
  successMessage: string | ((result: Result) => string),
  operation: () => Result,
): Result {
  const spinner = ui.spinner(label).start();
  try {
    const result = operation();
    const message = typeof successMessage === 'string' ? successMessage : successMessage(result);
    spinner.succeed(message);
    return result;
  } catch (error: unknown) {
    spinner.fail(`${label} failed`);
    throw error;
  }
}
