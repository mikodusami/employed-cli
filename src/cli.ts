#!/usr/bin/env node
/** Creates the root command, selects the UI, and contains fatal CLI errors. */
import { Command } from 'commander';

import { buildAiRunner, type AiRunner } from './ai/index.js';
import { ConfigService } from './config/index.js';
import { register as registerApp } from './commands/app.js';
import { register as registerApply } from './commands/apply.js';
import { register as registerBoard } from './commands/board.js';
import { register as registerCompany } from './commands/company.js';
import { register as registerDismiss } from './commands/dismiss.js';
import { register as registerDoctor } from './commands/doctor.js';
import { register as registerImport } from './commands/import.js';
import { register as registerInit } from './commands/init.js';
import { register as registerMove } from './commands/move.js';
import { register as registerNew } from './commands/new.js';
import { register as registerNote } from './commands/note.js';
import { register as registerRescore } from './commands/rescore.js';
import { register as registerRun } from './commands/run.js';
import { register as registerScan } from './commands/scan.js';
import { register as registerSchedule } from './commands/schedule.js';
import { register as registerStats } from './commands/stats.js';
import { register as registerSync } from './commands/sync.js';
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
  let ai: AiRunner | null = null;
  let isAiInitialized = false;
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
  const getAi = (): AiRunner | null => {
    if (!isAiInitialized) {
      ai = buildAiRunner({
        repos: repositories ??= new Repositories(getDatabase()),
        config: config.loadApp(),
        debug: process.argv.includes('--verbose') ? (message) => ui.info(message) : undefined,
      });
      isAiInitialized = true;
    }
    return ai;
  };
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
    get ai() {
      return getAi();
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
  registerRescore(program, context);
  registerNew(program, context);
  registerRun(program, context);
  registerSchedule(program, context);
  registerSync(program, context);
  registerApply(program, context);
  registerBoard(program, context);
  registerApp(program, context);
  registerNote(program, context);
  registerMove(program, context);
  registerDismiss(program, context);
  registerStats(program, context);
  registerDoctor(program, context);

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
