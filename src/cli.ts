#!/usr/bin/env node
/** Creates the root command, selects the UI, and contains fatal CLI errors. */
import { Command } from 'commander';

import { ConfigService } from './config/index.js';
import { register as registerCompany } from './commands/company.js';
import { register as registerImport } from './commands/import.js';
import { register as registerInit } from './commands/init.js';
import { register as registerScan } from './commands/scan.js';
import type { CommandContext } from './commands/types.js';
import { VERSION } from './constants.js';
import { createDb, Repositories } from './db/index.js';
import { SignatureDetector, type AtsDetector } from './scrape/detect.js';
import { createUI } from './ui/index.js';
import { AppError } from './util/errors.js';
import { buildHttpClient, type HttpClient, RobotsGate } from './util/http.js';

interface ProgramOptions {
  animation: boolean;
  verbose: boolean;
}

/** Builds and executes the employed CLI. */
async function run(): Promise<void> {
  const isAnimationEnabled = !process.argv.includes('--no-animation');
  const ui = createUI(isAnimationEnabled);
  const config = new ConfigService();
  let database: ReturnType<typeof createDb> | undefined;
  let repositories: Repositories | undefined;
  let http: HttpClient | undefined;
  let detector: AtsDetector | undefined;
  const getDatabase = (): ReturnType<typeof createDb> => (database ??= createDb());
  const getHttp = (): HttpClient =>
    (http ??= buildHttpClient({
      db: getDatabase(),
      config: config.loadApp(),
      onCacheHit: process.argv.includes('--verbose')
        ? (url) => ui.info(`HTTP 304 cache hit: ${url}`)
        : undefined,
    }));
  const getDetector = (): AtsDetector =>
    (detector ??= new SignatureDetector(
      getHttp(),
      new RobotsGate(getHttp()),
      config.loadApp().run.respectRobots,
    ));
  const context: CommandContext = {
    ui,
    config,
    get db() {
      return getDatabase();
    },
    get repos() {
      return (repositories ??= new Repositories(getDatabase()));
    },
    get detector() {
      return getDetector();
    },
    get http() {
      return getHttp();
    },
  };
  const program = new Command()
    .name('employed')
    .version(VERSION)
    .description('A personal job-search operation on autopilot.')
    .option('--no-animation', 'disable animated terminal output')
    .option('--verbose', 'show HTTP cache diagnostics');

  registerInit(program, context);
  registerCompany(program, context);
  registerImport(program, context);
  registerScan(program, context);

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
