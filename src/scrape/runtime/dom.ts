/** DOM-mode runtime facade with a structured execution report. */
import type { CompanyRow } from '../../db/index.js';
import type { HttpClient } from '../../util/http.js';
import { BrowserPool } from '../browser.js';
import { GeneratedSource, PlaywrightGeneratedSource } from '../generated.js';
import type { DomPlan } from '../plan.js';
import type { RawPosting, ScrapeSource } from '../types.js';
import type { ExecutionReport } from './api.js';

/** Selects the hardened static or browser DOM executor from plan data. */
export class DomExecutor implements ScrapeSource {
  public readonly method: 'generated-static' | 'generated-playwright';

  public constructor(
    private readonly http: HttpClient,
    private readonly browsers: BrowserPool | undefined,
    private readonly plan: DomPlan,
  ) {
    this.method = plan.strategy === 'static' ? 'generated-static' : 'generated-playwright';
  }

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    return (await this.execute(company)).postings;
  }

  public async execute(company: CompanyRow): Promise<ExecutionReport> {
    let requestCount = 0;
    const countingHttp: HttpClient = {
      fetchText: async (url, options) => {
        requestCount += 1;
        return this.http.fetchText(url, options);
      },
      postJson: async (url, body, options) => {
        requestCount += 1;
        return this.http.postJson(url, body, options);
      },
    };
    try {
      const source =
        this.plan.strategy === 'static'
          ? new GeneratedSource(countingHttp, this.plan)
          : this.browsers
            ? new PlaywrightGeneratedSource(this.browsers, this.plan)
            : null;
      if (!source) {
        return {
          postings: [],
          requestCount,
          pageCount: 0,
          errors: ['DOM plan requires Playwright, but no browser runtime is available.'],
        };
      }
      const postings = await source.fetchPostings(company);
      return {
        postings,
        requestCount,
        pageCount: this.plan.strategy === 'static' ? requestCount : 1,
        errors: [],
      };
    } catch (error: unknown) {
      return {
        postings: [],
        requestCount,
        pageCount: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }
}
