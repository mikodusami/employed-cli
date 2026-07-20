/** Implements company-registry business rules independently of CLI wording. */
import type { CompaniesFile } from '../config/index.js';
import type { CompanyRow, Repositories, Tier } from '../db/index.js';
import type { AtsDetector, DetectionResult } from '../scrape/detect.js';
import { ValidationError } from '../util/errors.js';
import { ScrapeService, type SmokeResult } from './scrape.js';

/** User input accepted when adding one company. */
export interface AddCompanyInput {
  name: string;
  url: string;
  tier?: Tier;
}

/** Structured outcome of adding one company. */
export interface AddResult {
  outcome: 'created' | 'duplicate';
  company: CompanyRow;
  detection: DetectionResult | null;
  smoke: SmokeResult | null;
}

/** One company that could not be imported. */
export interface ImportFailure {
  name: string;
  reason: string;
}

/** Aggregate result of a non-aborting company import. */
export interface ImportSummary {
  created: number;
  skipped: number;
  failed: number;
  failures: readonly ImportFailure[];
}

/** Progress reported after each company import attempt. */
export interface ImportProgress {
  name: string;
  outcome: 'created' | 'duplicate' | 'failed';
  reason?: string;
}

/** Owns company registry validation, detection, and batch rules. */
export class CompanyService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly detector: AtsDetector,
    private readonly scrapeService: ScrapeService,
  ) {}

  /** Validates, inserts, detects, and updates one company. */
  public async add(input: AddCompanyInput): Promise<AddResult> {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new ValidationError('Company name must not be empty.');
    }

    const duplicate = this.repositories.companies.findByName(name);
    if (duplicate) {
      return { outcome: 'duplicate', company: duplicate, detection: null, smoke: null };
    }

    const careersUrl = normalizeCareersUrl(input.url);
    const company = this.repositories.companies.insert({
      name,
      careers_url: careersUrl,
      tier: input.tier ?? 'B',
    });
    const detection = await this.detector.detect(careersUrl);
    const updatedCompany = this.repositories.companies.updateMethod(
      company.id,
      detection.method,
      detection.slug,
    );
    const smoke = await this.scrapeService.smokeTest(updatedCompany);
    const finalCompany = this.repositories.companies.findByName(name) ?? updatedCompany;
    return { outcome: 'created', company: finalCompany, detection, smoke };
  }

  /** Imports every valid entry while containing individual failures. */
  public async importFromConfig(
    companiesFile: CompaniesFile,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<ImportSummary> {
    let created = 0;
    let skipped = 0;
    const failures: ImportFailure[] = [];

    for (const company of companiesFile.companies) {
      try {
        const result = await this.add({
          name: company.name,
          url: company.url,
          tier: company.tier ?? companiesFile.defaults.tier,
        });
        if (result.outcome === 'created') {
          created += 1;
          onProgress?.({ name: company.name, outcome: 'created' });
        } else {
          skipped += 1;
          onProgress?.({ name: company.name, outcome: 'duplicate' });
        }
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push({ name: company.name, reason });
        onProgress?.({ name: company.name, outcome: 'failed', reason });
      }
    }

    return { created, skipped, failed: failures.length, failures };
  }

  /** Lists all registered companies in repository order. */
  public list(): CompanyRow[] {
    return [...this.repositories.companies.list()];
  }
}

function normalizeCareersUrl(value: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch (error: unknown) {
    throw new ValidationError('Careers URL must be a valid http or https URL.', { cause: error });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ValidationError('Careers URL must use http or https.');
  }

  parsedUrl.hash = '';
  return parsedUrl.toString();
}
