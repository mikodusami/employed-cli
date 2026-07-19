#!/usr/bin/env node
/** Creates the root command, selects the UI, and contains fatal CLI errors. */
import { Command } from 'commander';

import { VERSION } from './constants.js';
import { createUI } from './ui/index.js';

interface ProgramOptions {
  animation: boolean;
}

/** Builds and executes the employed CLI. */
async function run(): Promise<void> {
  const program = new Command()
    .name('employed')
    .version(VERSION)
    .description('A personal job-search operation on autopilot.')
    .option('--no-animation', 'disable animated terminal output');

  await program.parseAsync(process.argv);

  const options = program.opts<ProgramOptions>();
  createUI(options.animation).banner();
}

try {
  await run();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  createUI(false).error(message);
  process.exitCode = 1;
}
