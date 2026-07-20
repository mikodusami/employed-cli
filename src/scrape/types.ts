/** Defines source-neutral scraping contracts shared by adapters and generated scrapers. */
import type { CompanyRow, ScrapeMethod } from '../db/index.js';

/** Pre-normalization posting emitted by every scraping source. */
export interface RawPosting {
  title: string;
  url: string;
  location?: string | null;
  department?: string | null;
  description?: string | null;
  externalId?: string | null;
}

/** Retrieves raw postings for one supported scraping method. */
export interface ScrapeSource {
  readonly method: ScrapeMethod;
  fetchPostings(company: CompanyRow): Promise<RawPosting[]>;
}
