#!/usr/bin/env node
/** Creates the root command, selects the UI, and contains fatal CLI errors. */
import { Command } from 'commander';

import { ConfigService } from './config/index.js';
import { register as registerInit } from './commands/init.js';
import type { CommandContext } from './commands/types.js';
import { VERSION } from './constants.js';
import { createDb, Repositories } from './db/index.js';
import { createUI } from './ui/index.js';

interface ProgramOptions {
  animation: boolean;
}

/** Builds and executes the employed CLI. */
async function run(): Promise<void> {
  const isAnimationEnabled = !process.argv.includes('--no-animation');
  const ui = createUI(isAnimationEnabled);
  let database: ReturnType<typeof createDb> | undefined;
  let repositories: Repositories | undefined;
  const getDatabase = (): ReturnType<typeof createDb> => (database ??= createDb());
  const context: CommandContext = {
    ui,
    config: new ConfigService(),
    get database() {
      return getDatabase();
    },
    get repositories() {
      return (repositories ??= new Repositories(getDatabase()));
    },
  };
  const program = new Command()
    .name('employed')
    .version(VERSION)
    .description('A personal job-search operation on autopilot.')
    .option('--no-animation', 'disable animated terminal output');

  registerInit(program, context);

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
  const message = error instanceof Error ? error.message : String(error);
  createUI(false).error(message);
  process.exitCode = 1;
}
