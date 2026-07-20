/** Provides prepared, intent-oriented access to company records. */
import type Database from 'better-sqlite3';

import type { CompanyRow, Health, ScrapeMethod, Tier } from '../types.js';

/** Values required to create a company. */
export interface InsertCompanyInput {
  name: string;
  tier: Tier;
  careers_url: string;
  scrape_method?: ScrapeMethod;
  scrape_slug?: string | null;
  scrape_config?: string | null;
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
    [{ id: number; yieldCount: number }],
    Database.RunResult
  >;
  private readonly recordFailureStatement: Database.Statement<
    [CompanyIdParameter],
    Database.RunResult
  >;

  public constructor(database: Database.Database) {
    this.insertStatement = database.prepare(`
      INSERT INTO companies (
        name, tier, careers_url, scrape_method, scrape_slug, scrape_config
      ) VALUES (
        @name, @tier, @careers_url,
        COALESCE(@scrape_method, 'unknown'), @scrape_slug, @scrape_config
      )
    `);
    this.findByIdStatement = database.prepare('SELECT * FROM companies WHERE id = @id');
    this.findByNameStatement = database.prepare('SELECT * FROM companies WHERE name = @name');
    this.listStatement = database.prepare('SELECT * FROM companies ORDER BY tier, name');
    this.updateMethodStatement = database.prepare(`
      UPDATE companies
      SET scrape_method = @method,
          scrape_slug = @slug,
          scrape_config = @config,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);
    this.updateHealthStatement = database.prepare(`
      UPDATE companies
      SET health = @health, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);
    this.recordSuccessStatement = database.prepare(`
      UPDATE companies
      SET health = 'healthy',
          last_success_at = CURRENT_TIMESTAMP,
          consecutive_failures = 0,
          last_yield_count = @yieldCount,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);
    this.recordFailureStatement = database.prepare(`
      UPDATE companies
      SET last_failure_at = CURRENT_TIMESTAMP,
          consecutive_failures = consecutive_failures + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);
  }

  /** Inserts and returns a company. */
  public insert(input: InsertCompanyInput): CompanyRow {
    const parameters: InsertCompanyInput = {
      ...input,
      scrape_method: input.scrape_method ?? 'unknown',
      scrape_slug: input.scrape_slug ?? null,
      scrape_config: input.scrape_config ?? null,
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

  /** Records a successful scrape and resets its failure streak. */
  public recordSuccess(id: number, yieldCount: number): CompanyRow {
    this.recordSuccessStatement.run({ id, yieldCount });
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
