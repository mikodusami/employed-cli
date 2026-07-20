/** Registers company add and list command orchestration. */
import { Option, type Command } from 'commander';

import type { Tier } from '../db/index.js';
import { CompanyService } from '../services/company.js';
import { ScrapeService } from '../services/scrape.js';
import { relativeTime } from '../util/time.js';
import type { CommandContext } from './types.js';

interface AddOptions {
  url: string;
  tier?: Tier;
}

/** Adds the company command group to the root program. */
export function register(program: Command, context: CommandContext): void {
  const company = program.command('company').description('manage the company registry');

  company
    .command('add <name>')
    .description('add a company careers page')
    .requiredOption('--url <url>', 'company careers URL')
    .addOption(new Option('--tier <tier>', 'priority tier').choices(['A', 'B', 'C']))
    .action(async (name: string, options: AddOptions) => {
      await addCompany(context, name, options);
    });

  company
    .command('list')
    .description('list registered companies')
    .action(() => listCompanies(context));
}

async function addCompany(
  context: CommandContext,
  name: string,
  options: AddOptions,
): Promise<void> {
  const spinner = context.ui.spinner(`Adding ${name} and checking its careers site`).start();
  try {
    const service = createCompanyService(context);
    const result = await service.add({ name, url: options.url, tier: options.tier });
    if (result.outcome === 'duplicate') {
      spinner.succeed(`${result.company.name} is already registered; no changes made`);
      return;
    }

    const detection = result.detection;
    if (detection && detection.method !== 'unknown' && detection.slug) {
      spinner.succeed(
        `${result.company.name} — detected: ${detection.method} (slug: ${detection.slug})`,
      );
      if (!result.smoke?.ok) {
        context.ui.warn(`Adapter smoke test failed: ${result.smoke?.reason ?? 'unknown reason'}`);
      }
      return;
    }
    const detail = detection?.detail ?? 'no detail';
    spinner.succeed(`${result.company.name} — detected: unknown (${detail})`);
  } catch (error: unknown) {
    spinner.fail(`Could not add ${name}`);
    throw error;
  }
}

function listCompanies(context: CommandContext): void {
  const service = createCompanyService(context);
  const companies = service.list();
  if (companies.length === 0) {
    context.ui.info('No companies yet. Run `employed company add` or `employed import`.');
    return;
  }

  context.ui.table(
    ['Name', 'Tier', 'Method', 'Health', 'Last Yield', 'Last Success'],
    companies.map((company) => [
      company.name,
      company.tier,
      company.scrape_method,
      company.health,
      company.last_yield?.toString() ?? '—',
      company.last_success ? relativeTime(company.last_success) : '—',
    ]),
  );
}

function createCompanyService(context: CommandContext): CompanyService {
  const scrapeService = new ScrapeService(context.repos, context.http);
  return new CompanyService(context.repos, context.detector, scrapeService);
}
