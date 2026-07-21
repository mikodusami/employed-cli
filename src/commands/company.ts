/** Registers company add and list command orchestration. */
import { Option, type Command } from 'commander';

import type { Tier } from '../db/index.js';
import type { GenerateResult } from '../services/generate.js';
import { ScrapeRuntime } from '../services/scrape-runtime.js';
import type { ProgressHandle } from '../ui/index.js';
import { ValidationError } from '../util/errors.js';
import { relativeTime } from '../util/time.js';
import type { CommandContext } from './types.js';
import { bindProgress } from './progress.js';

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
    .command('generate <name>')
    .description('generate and validate a scraper for a custom careers page')
    .action(async (name: string) => generateCompany(context, name));

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
  const progress = bindProgress(context, `Adding ${name}`);
  const runtime = createRuntime(context);
  try {
    progress.handle.step('checking careers site');
    const result = await runtime.companies.add({ name, url: options.url, tier: options.tier });
    if (result.outcome === 'duplicate') {
      progress.handle.succeed(`${result.company.name} is already registered; no changes made`);
      return;
    }

    const detection = result.detection;
    if (detection && detection.method !== 'unknown' && detection.slug) {
      progress.handle.succeed(
        `${result.company.name} — detected: ${detection.method} (slug: ${detection.slug})`,
      );
      if (!result.smoke?.ok) {
        context.ui.warn(`Adapter smoke test failed: ${result.smoke?.reason ?? 'unknown reason'}`);
      }
      return;
    }
    if (result.generation) {
      renderGenerationResult(context, result.company.name, result.generation, progress.handle);
      return;
    }
    const detail = detection?.detail ?? 'no detail';
    progress.handle.succeed(`${result.company.name} — detected: unknown (${detail})`);
  } catch (error: unknown) {
    progress.handle.fail(`Could not add ${name}`);
    throw error;
  } finally {
    progress.release();
    await runtime.close();
  }
}

async function generateCompany(context: CommandContext, name: string): Promise<void> {
  const company = context.repos.companies.findByName(name);
  if (!company) {
    throw new ValidationError(`Company ${name} is not registered.`);
  }
  const progress = bindProgress(context, `Generating scraper for ${company.name}`);
  const runtime = createRuntime(context);
  try {
    const result = await runtime.generator.generateFor(company);
    renderGenerationResult(context, company.name, result, progress.handle);
  } catch (error: unknown) {
    progress.handle.fail(`Could not generate a scraper for ${company.name}`);
    throw error;
  } finally {
    progress.release();
    await runtime.close();
  }
}

function renderGenerationResult(
  context: CommandContext,
  companyName: string,
  result: GenerateResult,
  spinner: ProgressHandle,
): void {
  if (result.status === 'generated') {
    spinner.succeed(
      `${companyName} — generated-${result.strategy} config, ${result.jobCount} jobs, ` +
        `confidence ${result.confidence.toFixed(2)}`,
    );
    return;
  }
  if (result.status === 'skipped') {
    spinner.succeed(`${companyName} remains registered without a generated scraper`);
    context.ui.warn(`${result.reason} Run \`employed company generate "${companyName}"\` later.`);
    return;
  }
  spinner.fail(
    `${companyName} scraper needs manual review; diagnostics: ${result.diagnosticsPath}`,
  );
  for (const reason of result.reasons) {
    context.ui.warn(reason);
  }
}

function listCompanies(context: CommandContext): void {
  const companies = context.repos.companies.list();
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

function createRuntime(context: CommandContext): ScrapeRuntime {
  return new ScrapeRuntime({
    repositories: context.repos,
    http: context.http,
    detector: context.detector,
    ai: context.ai,
    config: context.config.loadApp(),
    keywords: context.config.loadKeywords(),
    report: context.stages.report,
  });
}
