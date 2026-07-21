/** Registers non-aborting company batch import orchestration. */
import type { Command } from 'commander';

import type { ImportProgress } from '../services/company.js';
import { ScrapeRuntime } from '../services/scrape-runtime.js';
import type { CommandContext } from './types.js';
import { bindProgress } from './progress.js';

/** Adds the company import command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('import [file]')
    .description('import companies from a YAML file')
    .action(async (file?: string) => importCompanies(context, file));
}

async function importCompanies(context: CommandContext, file?: string): Promise<void> {
  const companiesFile = context.config.loadCompanies(file);
  let current = 0;
  let currentName = '';
  const total = companiesFile.companies.length;
  const progress = bindProgress(
    context,
    'Importing companies',
    () => (currentName ? `[${current}/${total}] ${currentName} — ` : ''),
  );
  const runtime = new ScrapeRuntime({
    repositories: context.repos,
    http: context.http,
    detector: context.detector,
    ai: context.ai,
    config: context.config.loadApp(),
    keywords: context.config.loadKeywords(),
    report: context.stages.report,
  });

  try {
    const summary = await runtime.companies.importFromConfig(companiesFile, (event) => {
      if (event.outcome === 'started') {
        current += 1;
        currentName = event.name;
        return;
      }
      const message = formatProgress(event);
      const failed = event.outcome === 'failed';
      progress.handle.substep(`${failed ? '✗' : '✓'} ${message}`);
      context.log
        .child(`import:${event.name}`)
        .event(failed ? 'error' : 'info', message, undefined, false);
    });
    progress.handle.succeed('Company import complete');
    context.ui.heading('Import summary');
    context.ui.info(`created: ${summary.created}`);
    context.ui.info(`skipped-duplicate: ${summary.skipped}`);
    context.ui.info(`failed: ${summary.failed}`);
    for (const failure of summary.failures) {
      context.ui.warn(`${failure.name}: ${failure.reason}`);
    }
  } catch (error: unknown) {
    progress.handle.fail('Company import failed');
    throw error;
  } finally {
    progress.release();
    await runtime.close();
  }
}

function formatProgress(progress: ImportProgress): string {
  if (progress.outcome === 'failed') {
    return `${progress.name}: failed — ${progress.reason ?? 'unknown error'}`;
  }
  return `${progress.name}: ${progress.outcome}`;
}
