/** Run-scoped budgets and orchestration for automatic scraper repair. */
import type { CompanyRow, Repositories, ScrapeMethod } from '../db/index.js';
import type { AtsDetector } from '../scrape/detect.js';
import type { GenerateService } from './generate.js';
import type { SmokeResult } from './scrape.js';

export interface HealLimits {
  maxPerCompany: number;
  maxPerRun: number;
}

export interface HealResult {
  healed: boolean;
  deferred: boolean;
  attempted: boolean;
  note: string;
}

interface SmokeTester {
  smokeTest(company: CompanyRow): Promise<SmokeResult>;
}

/** Counts accepted heal attempts across every company in one run. */
export class HealBudget {
  private total = 0;
  private readonly perCompany = new Map<number, number>();

  public constructor(private readonly limits: HealLimits) {}

  public consume(companyId: number): { allowed: true } | { allowed: false; note: string } {
    const companyAttempts = this.perCompany.get(companyId) ?? 0;
    if (companyAttempts >= this.limits.maxPerCompany) {
      return {
        allowed: false,
        note: `Heal budget exhausted for company (${this.limits.maxPerCompany} per run).`,
      };
    }
    if (this.total >= this.limits.maxPerRun) {
      return {
        allowed: false,
        note: `Global heal budget exhausted (${this.limits.maxPerRun} per run).`,
      };
    }
    this.total += 1;
    this.perCompany.set(companyId, companyAttempts + 1);
    return { allowed: true };
  }
}

/** Reuses detection, smoke testing, and generation without owning scraper logic. */
export class HealService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly detector: AtsDetector,
    private readonly smokeTester: SmokeTester,
    private readonly generator: GenerateService | null,
  ) {}

  public async heal(company: CompanyRow, budget: HealBudget): Promise<HealResult> {
    const failed = this.repositories.companies.recordFailure(company.id);
    this.repositories.companies.updateHealth(company.id, 'degraded');
    if (failed.consecutive_failures === 1) {
      return {
        healed: false,
        deferred: true,
        attempted: false,
        note: `${company.name} heal deferred after its first consecutive failure.`,
      };
    }

    const admission = budget.consume(company.id);
    if (!admission.allowed) {
      return { healed: false, deferred: true, attempted: false, note: admission.note };
    }

    if (isAtsMethod(company.scrape_method)) {
      const detection = await this.detector.detect(company);
      if (isAtsMethod(detection.method)) {
        const detectedCompany = this.repositories.companies.updateMethod(
          company.id,
          detection.method,
          detection.slug,
        );
        const smoke = await this.smokeTester.smokeTest(detectedCompany);
        if (smoke.ok) {
          this.repositories.companies.updateHealth(company.id, 'ok');
          return {
            healed: true,
            deferred: false,
            attempted: true,
            note: `${company.name} scraper re-detected as ${detection.method}.`,
          };
        }
      }
    }

    if (!this.generator) {
      return {
        healed: false,
        deferred: true,
        attempted: true,
        note: `${company.name} could not be regenerated because AI is unavailable.`,
      };
    }

    const generated = await this.generator.generateFor(
      this.repositories.companies.findByName(company.name) ?? company,
    );
    if (generated.status === 'generated') {
      this.repositories.companies.updateHealth(company.id, 'ok');
      return {
        healed: true,
        deferred: false,
        attempted: true,
        note: `${company.name} scraper regenerated.`,
      };
    }
    if (generated.status === 'skipped') {
      this.repositories.companies.updateHealth(company.id, 'degraded');
      return {
        healed: false,
        deferred: true,
        attempted: true,
        note: `${company.name} regeneration skipped: ${generated.reason}`,
      };
    }
    this.repositories.companies.updateHealth(company.id, 'broken');
    return {
      healed: false,
      deferred: false,
      attempted: true,
      note: `${company.name} heal failed: ${generated.reasons.join('; ')}`,
    };
  }
}

function isAtsMethod(method: ScrapeMethod): boolean {
  return [
    'greenhouse',
    'lever',
    'ashby',
    'workday',
    'smartrecruiters',
    'recruitee',
  ].includes(method);
}
