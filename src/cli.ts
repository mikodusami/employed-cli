#!/usr/bin/env node
/** Creates the root command, selects the UI, and contains fatal CLI errors. */
import { Command } from 'commander';

import { ConfigService } from './config/index.js';
import { register as registerCompany } from './commands/company.js';
import { register as registerImport } from './commands/import.js';
import { register as registerInit } from './commands/init.js';
import type { CommandContext } from './commands/types.js';
import { VERSION } from './constants.js';
import { createDb, Repositories } from './db/index.js';
import { SignatureDetector } from './scrape/detect.js';
import { createUI } from './ui/index.js';
import { AppError } from './util/errors.js';
import { UndiciHttpClient } from './util/http.js';

interface ProgramOptions {
  animation: boolean;
}

/** Builds and executes the employed CLI. */
async function run(): Promise<void> {
  const isAnimationEnabled = !process.argv.includes('--no-animation');
  const ui = createUI(isAnimationEnabled);
  const http = new UndiciHttpClient();
  let database: ReturnType<typeof createDb> | undefined;
  let repositories: Repositories | undefined;
  const getDatabase = (): ReturnType<typeof createDb> => (database ??= createDb());
  const context: CommandContext = {
    ui,
    config: new ConfigService(),
    get db() {
      return getDatabase();
    },
    get repos() {
      return (repositories ??= new Repositories(getDatabase()));
    },
    detector: new SignatureDetector(http),
    http,
  };
  const program = new Command()
    .name('employed')
    .version(VERSION)
    .description('A personal job-search operation on autopilot.')
    .option('--no-animation', 'disable animated terminal output');

  registerInit(program, context);
  registerCompany(program, context);
  registerImport(program, context);

  try {
    await program.parseAsync(process.argv);

    const options = program.opts<ProgramOptions>();
    if (program.args.length === 0) {
      createUI(options.animation).banner();
    }
  } finally {
    database?.close();
  }
}

try {
  await run();
} catch (error: unknown) {
  createUI(false).error(formatFatalError(error));
  process.exitCode = 1;
}

function formatFatalError(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
