/** Generic executor for validated static scraper configurations. */
import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

import type { CompanyRow } from '../db/index.js';
import { AdapterError, RequiresRenderError } from '../util/errors.js';
import type { HttpClient } from '../util/http.js';
import { ScraperConfigSchema, type ScraperConfig } from './config.js';
import type { RawPosting, ScrapeSource } from './types.js';

type FieldConfig = ScraperConfig['fields']['title'];

/** Executes all company-specific selector behavior as configuration data. */
export class GeneratedSource implements ScrapeSource {
  public readonly method = 'generated-static' as const;

  public constructor(
    private readonly http: HttpClient,
    private readonly suppliedConfig?: ScraperConfig,
  ) {}

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    const config = this.suppliedConfig ?? parseStoredConfig(company);
    requireStaticStrategy(config);

    const postings: RawPosting[] = [];
    let pageUrl = company.careers_url;
    for (let page = 1; page <= config.pagination.maxPages; page += 1) {
      const response = await this.http.fetchText(pageUrl);
      if (response.status < 200 || response.status >= 300) {
        throw new AdapterError(`Generated scraper received HTTP ${response.status}.`);
      }
      const $ = load(response.body);
      const pagePostings = extractPostings($, config, response.finalUrl);
      if (page > 1 && pagePostings.length === 0) {
        break;
      }
      postings.push(...pagePostings);

      const nextUrl = nextPageUrl($, config, response.finalUrl, page + 1);
      if (!nextUrl) {
        break;
      }
      pageUrl = nextUrl;
    }
    return postings;
  }
}

function parseStoredConfig(company: CompanyRow): ScraperConfig {
  if (!company.scraper_config) {
    throw new AdapterError(`Company ${company.name} has no generated scraper configuration.`);
  }
  try {
    return ScraperConfigSchema.parse(JSON.parse(company.scraper_config));
  } catch (error: unknown) {
    throw new AdapterError(`Company ${company.name} has an invalid scraper configuration.`, {
      cause: error,
    });
  }
}

function requireStaticStrategy(config: ScraperConfig): void {
  if (
    config.strategy !== 'static' ||
    config.pagination.type === 'load-more-button' ||
    config.pagination.type === 'infinite-scroll'
  ) {
    throw new RequiresRenderError('Generated scraper requires browser rendering.');
  }
}

function extractPostings(
  $: CheerioAPI,
  config: ScraperConfig,
  pageUrl: string,
): RawPosting[] {
  const postings: RawPosting[] = [];
  $(config.listSelector).each((_index, element) => {
    const title = extractField($, element, config.fields.title) ?? '';
    const rawUrl = extractField($, element, config.fields.url) ?? '';
    postings.push({
      title,
      url: resolvePostingUrl(rawUrl, config.urlPrefix ?? pageUrl),
      location: extractField($, element, config.fields.location),
      department: extractField($, element, config.fields.department),
    });
  });
  return postings;
}

function extractField(
  $: CheerioAPI,
  element: AnyNode,
  field: FieldConfig | null,
): string | null {
  if (!field) {
    return null;
  }
  const selected = field.selector === ':scope' ? $(element) : $(element).find(field.selector).first();
  const value = field.attr === 'text' ? selected.text() : selected.attr(field.attr);
  return value?.trim() || null;
}

function resolvePostingUrl(value: string, baseUrl: string): string {
  if (value.length === 0) {
    return '';
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function nextPageUrl(
  $: CheerioAPI,
  config: ScraperConfig,
  currentUrl: string,
  nextPage: number,
): string | null {
  switch (config.pagination.type) {
    case 'none':
      return null;
    case 'next-link': {
      const selector = config.pagination.value;
      const href = selector ? $(selector).first().attr('href') : null;
      return href ? new URL(href, currentUrl).toString() : null;
    }
    case 'url-param': {
      const template = config.pagination.value;
      if (!template?.includes('{n}')) {
        throw new AdapterError('url-param pagination value must contain {n}.');
      }
      return new URL(template.replaceAll('{n}', String(nextPage)), currentUrl).toString();
    }
    case 'load-more-button':
    case 'infinite-scroll':
      throw new RequiresRenderError('Generated scraper pagination requires browser rendering.');
  }
}
