/** Registers single-company job scanning orchestration. */
import type { Command } from 'commander';

import { describeAutoFiltered } from '../services/scrape.js';
import { ScrapeRuntime } from '../services/scrape-runtime.js';
import { bindProgress } from './progress.js';
import type { CommandContext } from './types.js';

interface ScanOptions {
  company: string;
}

/** Adds the single-company scan command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('scan')
    .description('scan one company for current jobs')
    .requiredOption('--company <name>', 'registered company name')
    .action(async (options: ScanOptions) => scanCompany(context, options.company));
}

async function scanCompany(context: CommandContext, companyName: string): Promise<void> {
  const company = context.repos.companies.findByName(companyName);
  if (!company) {
    context.ui.warn(`Company not found: ${companyName}. Add or import it first.`);
    return;
  }

  const progress = bindProgress(context, `Scanning ${company.name}`);
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
    const result = await runtime.scraper.scrapeCompany(company);
    if (result.status === 'skipped') {
      progress.handle.fail(`${company.name} skipped: ${result.reason}`);
      return;
    }
    if (result.status === 'failed') {
      progress.handle.fail(`${company.name} (${result.method}) failed: ${result.reason}`);
      if (result.heal) {
        context.ui.warn(result.heal.note);
      }
      return;
    }

    const autoFilteredNote =
      result.autoFiltered > 0 ? `, ${describeAutoFiltered(result)} auto-filtered` : '';
    progress.handle.succeed(
      `${company.name} (${result.method}): ${result.seen} seen, ${result.new} new` +
        autoFilteredNote,
    );
    if (result.heal) {
      context.ui.info(result.heal.note);
    }
    if (result.newJobs.length > 0) {
      const rankedJobs = [...result.newJobs].sort(
        (left, right) => (right.score ?? Number.NEGATIVE_INFINITY) -
          (left.score ?? Number.NEGATIVE_INFINITY),
      );
      context.ui.table(
        ['Score', 'Band', 'Title', 'Location'],
        rankedJobs.map((job) => [
          job.score?.toString() ?? '—',
          job.band ?? '—',
          job.title,
          job.location ?? '—',
        ]),
      );
    }
  } catch (error: unknown) {
    progress.handle.fail(`${company.name} scan failed`);
    throw error;
  } finally {
    progress.release();
    await runtime.close();
  }
}
