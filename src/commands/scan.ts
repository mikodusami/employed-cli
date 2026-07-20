/** Registers single-company job scanning orchestration. */
import type { Command } from 'commander';

import { ScrapeRuntime } from '../services/scrape-runtime.js';
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

  const spinner = context.ui.spinner(`Fetching jobs for ${company.name}`).start();
  const runtime = new ScrapeRuntime({
    repositories: context.repos,
    http: context.http,
    detector: context.detector,
    ai: context.ai,
    config: context.config.loadApp(),
    keywords: context.config.loadKeywords(),
  });
  try {
    const result = await runtime.scraper.scrapeCompany(company);
    if (result.status === 'skipped') {
      spinner.fail(`${company.name} skipped: ${result.reason}`);
      return;
    }
    if (result.status === 'failed') {
      spinner.fail(`${company.name} (${result.method}) failed: ${result.reason}`);
      if (result.heal) {
        context.ui.warn(result.heal.note);
      }
      return;
    }

    spinner.succeed(
      `${company.name} (${result.method}): ${result.seen} seen, ${result.new} new`,
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
  } finally {
    await runtime.close();
  }
}
