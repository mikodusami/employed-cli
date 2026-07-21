/** Composes one run-scoped scraper fleet with shared browser and heal budgets. */
import type { AiRunner } from '../ai/types.js';
import type { AppConfig, KeywordsFile } from '../config/schema.js';
import type { Repositories } from '../db/index.js';
import { BrowserPool } from '../scrape/browser.js';
import type { AtsDetector } from '../scrape/detect.js';
import type { HttpClient } from '../util/http.js';
import { CompanyService } from './company.js';
import { GenerateService } from './generate.js';
import { HealBudget, HealService } from './heal.js';
import { ScrapeService, type ScrapeServiceOptions } from './scrape.js';

export interface ScrapeRuntimeDependencies {
  repositories: Repositories;
  http: HttpClient;
  detector: AtsDetector;
  ai: AiRunner | null;
  config: AppConfig;
  keywords: KeywordsFile;
}

/** Owns capabilities whose lifetime must match one command or scheduled run. */
export class ScrapeRuntime {
  public readonly browsers: BrowserPool;
  public readonly generator: GenerateService;
  public readonly scraper: ScrapeService;
  public readonly companies: CompanyService;

  public constructor(dependencies: ScrapeRuntimeDependencies) {
    this.browsers = new BrowserPool(dependencies.config.run.playwright.navTimeoutMs);
    this.generator = new GenerateService(
      dependencies.repositories,
      dependencies.http,
      dependencies.ai,
      this.browsers,
      {
        deadlines: dependencies.config.capture,
        maxAttempts: dependencies.config.generate.maxAttempts,
      },
    );
    const options: ScrapeServiceOptions = {
      browsers: this.browsers,
      keywords: dependencies.keywords,
    };
    this.scraper = new ScrapeService(dependencies.repositories, dependencies.http, options);
    options.healing = {
      service: new HealService(
        dependencies.repositories,
        dependencies.detector,
        this.scraper,
        dependencies.ai ? this.generator : null,
      ),
      budget: new HealBudget(dependencies.config.run.heal),
    };
    this.companies = new CompanyService(
      dependencies.repositories,
      dependencies.detector,
      this.scraper,
      dependencies.config.run.autoGenerateOnAdd ? this.generator : null,
      dependencies.config.run.autoGenerateOnAdd,
    );
  }

  public close(): Promise<void> {
    return this.browsers.close();
  }
}
