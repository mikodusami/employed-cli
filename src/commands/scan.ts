/** Registers single-company job scanning orchestration. */
import type { Command } from 'commander';

import { ScrapeService } from '../services/scrape.js';
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
  const service = new ScrapeService(context.repos, context.http);
  const result = await service.scrapeCompany(company);
  if (result.status === 'skipped') {
    spinner.fail(`${company.name} skipped: ${result.reason}`);
    return;
  }
  if (result.status === 'failed') {
    spinner.fail(`${company.name} (${result.method}) failed: ${result.reason}`);
    return;
  }

  spinner.succeed(
    `${company.name} (${result.method}): ${result.seen} seen, ${result.new} new`,
  );
  if (result.newJobs.length > 0) {
    context.ui.table(
      ['Title', 'Location', 'URL'],
      result.newJobs.map((job) => [job.title, job.location ?? '—', job.url]),
    );
  }
}
