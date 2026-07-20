/** Provides prepared, intent-oriented access to company records. */
import type Database from 'better-sqlite3';

import type { CompanyRow, Health, ScrapeMethod, Tier } from '../types.js';

/** Values required to create a company. */
export interface InsertCompanyInput {
  name: string;
  tier?: Tier;
  careers_url: string;
  scrape_method?: ScrapeMethod;
  slug?: string | null;
  scraper_config?: string | null;
}

interface CompanyIdParameter {
  id: number;
}

/** Owns every SQL operation involving the companies table. */
export class CompanyRepository {
  private readonly insertStatement: Database.Statement<[InsertCompanyInput], Database.RunResult>;
  private readonly findByIdStatement: Database.Statement<[CompanyIdParameter], CompanyRow>;
  private readonly findByNameStatement: Database.Statement<[{ name: string }], CompanyRow>;
  private readonly listStatement: Database.Statement<[], CompanyRow>;
  private readonly updateMethodStatement: Database.Statement<
    [{ id: number; method: ScrapeMethod; slug: string | null; config: string | null }],
    Database.RunResult
  >;
  private readonly updateHealthStatement: Database.Statement<
    [{ id: number; health: Health }],
    Database.RunResult
  >;
  private readonly recordSuccessStatement: Database.Statement<
    [{ id: number; yieldCount: number; occurredAt: string }],
    Database.RunResult
  >;
  private readonly recordFailureStatement: Database.Statement<
    [CompanyIdParameter],
    Database.RunResult
  >;

  public constructor(database: Database.Database) {
    this.insertStatement = database.prepare(`
      INSERT INTO companies (
        name, tier, careers_url, scrape_method, slug, scraper_config, created_at
      ) VALUES (
        @name, COALESCE(@tier, 'B'), @careers_url,
        COALESCE(@scrape_method, 'unknown'), @slug, @scraper_config, CURRENT_TIMESTAMP
      )
    `);
    this.findByIdStatement = database.prepare('SELECT * FROM companies WHERE id = @id');
    this.findByNameStatement = database.prepare(`
      SELECT * FROM companies WHERE name = @name COLLATE NOCASE
    `);
    this.listStatement = database.prepare('SELECT * FROM companies ORDER BY tier, name');
    this.updateMethodStatement = database.prepare(`
      UPDATE companies
      SET scrape_method = @method, slug = @slug, scraper_config = @config
      WHERE id = @id
    `);
    this.updateHealthStatement = database.prepare(`
      UPDATE companies
      SET health = @health,
          consecutive_failures = CASE
            WHEN @health = 'ok' THEN 0
            ELSE consecutive_failures
          END
      WHERE id = @id
    `);
    this.recordSuccessStatement = database.prepare(`
      UPDATE companies
      SET health = 'ok',
          last_success = @occurredAt,
          consecutive_failures = 0,
          last_yield = @yieldCount
      WHERE id = @id
    `);
    this.recordFailureStatement = database.prepare(`
      UPDATE companies
      SET consecutive_failures = consecutive_failures + 1
      WHERE id = @id
    `);
  }

  /** Inserts and returns a company. */
  public insert(input: InsertCompanyInput): CompanyRow {
    const parameters: InsertCompanyInput = {
      ...input,
      tier: input.tier ?? 'B',
      scrape_method: input.scrape_method ?? 'unknown',
      slug: input.slug ?? null,
      scraper_config: input.scraper_config ?? null,
    };
    const result = this.insertStatement.run(parameters);
    return this.requireById(Number(result.lastInsertRowid));
  }

  /** Finds a company by its exact unique name. */
  public findByName(name: string): CompanyRow | undefined {
    return this.findByNameStatement.get({ name });
  }

  /** Lists companies in priority and name order. */
  public list(): readonly CompanyRow[] {
    return this.listStatement.all();
  }

  /** Changes the scraper adapter and its adapter-specific settings. */
  public updateMethod(
    id: number,
    method: ScrapeMethod,
    slug: string | null = null,
    config: string | null = null,
  ): CompanyRow {
    this.updateMethodStatement.run({ id, method, slug, config });
    return this.requireById(id);
  }

  /** Updates scraper health without modifying run counters. */
  public updateHealth(id: number, health: Health): CompanyRow {
    this.updateHealthStatement.run({ id, health });
    return this.requireById(id);
  }

  /**
   * Records a successful scrape and resets its failure streak.
   *
   * @remarks `occurredAt` defaults to an ISO timestamp rather than SQL `CURRENT_TIMESTAMP` so it
   * shares a comparable format with `jobs.last_seen`, which the lifecycle sweep compares directly.
   */
  public recordSuccess(
    id: number,
    yieldCount: number,
    occurredAt: string = new Date().toISOString(),
  ): CompanyRow {
    this.recordSuccessStatement.run({ id, yieldCount, occurredAt });
    return this.requireById(id);
  }

  /** Records a failed scrape and increments its failure streak. */
  public recordFailure(id: number): CompanyRow {
    this.recordFailureStatement.run({ id });
    return this.requireById(id);
  }

  private requireById(id: number): CompanyRow {
    const company = this.findByIdStatement.get({ id });
    if (!company) {
      throw new Error(`Company ${id} does not exist.`);
    }
    return company;
  }
}
