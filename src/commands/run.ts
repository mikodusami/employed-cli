/** Registers the daily orchestration entry point: scrape, score, report, optional email. */
import type { Command } from 'commander';

import type { Tier } from '../db/index.js';
import { RUN_LOCK_PATH } from '../constants.js';
import { RunService, type RunSummary } from '../services/run.js';
import { acquireRunLock, LockHeldError, type RunLock } from '../util/lock.js';
import { ValidationError } from '../util/errors.js';
import type { CommandContext } from './types.js';

interface RunCommandOptions {
  email?: boolean;
  ai: boolean;
  tier?: string;
}

/** Adds the `run` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('run')
    .description('scrape every scheduled company, score, and write the daily report')
    .option('--email', 'send the daily report by email, even when email.enabled is false')
    .option('--no-ai', 'disable AI generation, healing, and Gmail sync for this run')
    .option('--tier <tiers>', 'comma-separated tier override, e.g. A,B (ignores the schedule)')
    .action(async (options: RunCommandOptions) => runOrchestration(context, options));
}

async function runOrchestration(
  context: CommandContext,
  options: RunCommandOptions,
): Promise<void> {
  let lock: RunLock;
  try {
    lock = acquireRunLock(RUN_LOCK_PATH);
  } catch (error: unknown) {
    if (error instanceof LockHeldError) {
      context.ui.warn(error.message);
      return;
    }
    throw error;
  }

  const spinner = context.ui.spinner('Starting run').start();
  try {
    const service = new RunService({
      repositories: context.repos,
      http: context.http,
      detector: context.detector,
      ai: options.ai ? context.ai : null,
      config: context.config.loadApp(),
      keywords: context.config.loadKeywords(),
    });
    const tiers = options.tier ? parseTiers(options.tier) : undefined;
    const summary = await service.execute({ tiers, email: options.email });
    spinner.succeed(
      `Run complete: ${summary.companiesScanned} companies scanned, ${summary.jobsNew} new jobs, ` +
        `${summary.failures.length} failures`,
    );
    renderSummary(context, summary);
    if (summary.email.sent) {
      context.ui.info('Email digest sent.');
    } else if (summary.email.error) {
      context.ui.warn(
        `Email delivery failed; the report remains at ${summary.reportPath}. ` +
          `Fix: ${summary.email.error}`,
      );
    }
  } catch (error: unknown) {
    spinner.fail('Run failed');
    throw error;
  } finally {
    lock.release();
  }
}

function renderSummary(context: CommandContext, summary: RunSummary): void {
  context.ui.table(
    ['Metric', 'Value'],
    [
      ['Report', summary.reportPath],
      ['Jobs seen', String(summary.jobsSeen)],
      ['Jobs new', String(summary.jobsNew)],
      ['Jobs closed', String(summary.jobsClosed)],
      ['Scrapers healed', String(summary.healed)],
      ['Scrapers broken', String(summary.broken)],
      ['AI calls', String(summary.aiCalls)],
    ],
  );
  for (const failure of summary.failures) {
    context.ui.warn(`${failure.company} (${failure.method}): ${failure.reason}`);
  }
}

function parseTiers(value: string): Tier[] {
  const tiers: Tier[] = [];
  for (const token of value.split(',')) {
    const tier = token.trim().toUpperCase();
    if (tier !== 'A' && tier !== 'B' && tier !== 'C') {
      throw new ValidationError(`Invalid tier: ${token.trim() || '<empty>'}.`);
    }
    tiers.push(tier);
  }
  return tiers;
}
