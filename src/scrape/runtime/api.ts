/** Generic hidden-JSON-API executor for validated version-2 plans. */
import type { CompanyRow } from '../../db/index.js';
import { AdapterError } from '../../util/errors.js';
import type { HttpClient } from '../../util/http.js';
import { ScraperPlanSchema, type ApiPlan } from '../plan.js';
import type { RawPosting, ScrapeSource } from '../types.js';
import { getAtPath } from './dot-path.js';

const KNOWN_ATS_HOST = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|recruitee\.com)$/i;
const MAX_PAGES = 25;

export interface ExecutionReport {
  postings: RawPosting[];
  requestCount: number;
  pageCount: number;
  errors: string[];
}

/** Executes API plans only through the shared HTTP policy stack. */
export class ApiExecutor implements ScrapeSource {
  public readonly method = 'generated-api' as const;

  public constructor(
    private readonly http: HttpClient,
    private readonly suppliedPlan?: ApiPlan,
    private readonly operationDeadlineMs = 45_000,
  ) {}

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    return (await this.execute(company)).postings;
  }

  public async execute(company: CompanyRow): Promise<ExecutionReport> {
    const plan = this.suppliedPlan ?? parseStoredPlan(company);
    const postings: RawPosting[] = [];
    const errors: string[] = [];
    let requestCount = 0;
    let pageCount = 0;
    const maxPages = Math.min(plan.pagination.maxPages, MAX_PAGES);

    for (let page = 1; page <= maxPages; page += 1) {
      const offset = (page - 1) * plan.pagination.pageSize;
      const url = applyPlaceholders(plan.request.urlTemplate, page, offset);
      assertAllowedPlanUrl(company.careers_url, url);
      const body = applyPlaceholders(plan.request.bodyTemplate, page, offset);
      const response =
        plan.request.method === 'GET'
          ? await this.http.fetchText(url, this.requestOptions(plan))
          : await this.http.postJson(url, parseRequestBody(body), this.requestOptions(plan));
      requestCount += 1;
      pageCount += 1;
      if (response.status < 200 || response.status >= 300) {
        errors.push(`API page ${page} returned HTTP ${response.status}.`);
        break;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(response.body);
      } catch {
        errors.push(`API page ${page} did not return valid JSON.`);
        break;
      }
      const items = getAtPath(payload, plan.response.itemsPath);
      if (!Array.isArray(items)) {
        errors.push(`itemsPath "${plan.response.itemsPath}" did not resolve to an array.`);
        break;
      }
      const mapped = items.map((item) => mapItem(item, plan)).filter(isPosting);
      postings.push(...mapped);
      if (shouldStop(plan, payload, items.length, postings.length)) {
        break;
      }
    }

    return { postings, requestCount, pageCount, errors };
  }

  private requestOptions(plan: ApiPlan) {
    return { headers: plan.request.headers, timeoutMs: this.operationDeadlineMs };
  }
}

function parseStoredPlan(company: CompanyRow): ApiPlan {
  if (!company.scraper_config) {
    throw new AdapterError(`Company ${company.name} has no generated scraper plan.`);
  }
  try {
    const plan = ScraperPlanSchema.parse(JSON.parse(company.scraper_config));
    if (plan.mode !== 'api') {
      throw new AdapterError(`Company ${company.name} stores a DOM plan, not an API plan.`);
    }
    return plan;
  } catch (error: unknown) {
    if (error instanceof AdapterError) {
      throw error;
    }
    throw new AdapterError(`Company ${company.name} has an invalid API scraper plan.`, {
      cause: error,
    });
  }
}

export function assertAllowedPlanUrl(companyUrl: string, requestUrl: string): void {
  let company: URL;
  let request: URL;
  try {
    company = new URL(companyUrl);
    request = new URL(requestUrl);
  } catch (error: unknown) {
    throw new AdapterError('API plan contains an invalid URL.', { cause: error });
  }
  if (!['http:', 'https:'].includes(request.protocol) || request.username || request.password) {
    throw new AdapterError('API plan URL must be an unauthenticated HTTP(S) URL.');
  }
  if (
    registrableDomain(company.hostname) !== registrableDomain(request.hostname) &&
    !KNOWN_ATS_HOST.test(request.hostname)
  ) {
    throw new AdapterError(`API plan URL host ${request.hostname} is outside the allowed domain.`);
  }
}

function mapItem(item: unknown, plan: ApiPlan): RawPosting | null {
  const title = scalar(getAtPath(item, plan.response.fields.title));
  const rawUrl = scalar(getAtPath(item, plan.response.fields.url));
  if (!title || !rawUrl) {
    return null;
  }
  return {
    title,
    url: resolveUrl(rawUrl, plan.response.urlPrefix),
    location: optionalScalar(item, plan.response.fields.location),
    department: optionalScalar(item, plan.response.fields.department),
    externalId: optionalScalar(item, plan.response.fields.externalId),
  };
}

function optionalScalar(item: unknown, path: string | null): string | null {
  return path === null ? null : scalar(getAtPath(item, path));
}

function scalar(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null;
}

function resolveUrl(value: string, prefix: string | null): string {
  if (!prefix) {
    return value;
  }
  try {
    return new URL(value, prefix).toString();
  } catch {
    return value;
  }
}

function isPosting(value: RawPosting | null): value is RawPosting {
  return value !== null;
}

function shouldStop(
  plan: ApiPlan,
  payload: unknown,
  itemCount: number,
  collectedCount: number,
): boolean {
  if (plan.pagination.type === 'none' || itemCount === 0) {
    return true;
  }
  const total = plan.response.totalPath
    ? getAtPath(payload, plan.response.totalPath)
    : undefined;
  return typeof total === 'number' && collectedCount >= total;
}

function applyPlaceholders(value: string, page: number, offset: number): string;
function applyPlaceholders(value: string | null, page: number, offset: number): string | null;
function applyPlaceholders(value: string | null, page: number, offset: number): string | null {
  return value?.replaceAll('{page}', String(page)).replaceAll('{offset}', String(offset)) ?? null;
}

function parseRequestBody(value: string | null): unknown {
  if (value === null) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch (error: unknown) {
    throw new AdapterError('API plan bodyTemplate is not valid JSON after substitution.', {
      cause: error,
    });
  }
}

function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  return labels.slice(-2).join('.');
}
