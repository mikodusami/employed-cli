/** Generic executor for validated static scraper configurations. */
import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Page } from 'playwright';

import type { CompanyRow } from '../db/index.js';
import { AdapterError, RequiresRenderError } from '../util/errors.js';
import type { HttpClient } from '../util/http.js';
import { BrowserPool } from './browser.js';
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

/** Acquires browser-rendered DOM while reusing the static field-extraction path. */
export class PlaywrightGeneratedSource implements ScrapeSource {
  public readonly method = 'generated-playwright' as const;

  public constructor(
    private readonly browsers: BrowserPool,
    private readonly suppliedConfig?: ScraperConfig,
  ) {}

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    const config = this.suppliedConfig ?? parseStoredConfig(company);
    return this.browsers.page(async (page) => {
      if (
        config.pagination.type === 'load-more-button' ||
        config.pagination.type === 'infinite-scroll'
      ) {
        return acquireExpandingPage(page, company.careers_url, config);
      }
      return acquireNavigatedPages(page, company.careers_url, config);
    });
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

async function acquireNavigatedPages(
  page: Page,
  initialUrl: string,
  config: ScraperConfig,
): Promise<RawPosting[]> {
  const postings: RawPosting[] = [];
  let pageUrl = initialUrl;
  for (let pageNumber = 1; pageNumber <= config.pagination.maxPages; pageNumber += 1) {
    await navigate(page, pageUrl);
    if (pageNumber === 1) {
      await page.waitForSelector(config.listSelector);
    } else if ((await page.locator(config.listSelector).count()) === 0) {
      break;
    }
    const pagePostings = extractPostings(load(await page.content()), config, page.url());
    if (pageNumber > 1 && pagePostings.length === 0) {
      break;
    }
    postings.push(...pagePostings);
    const nextUrl = await browserNextPageUrl(page, config, pageNumber + 1);
    if (!nextUrl) {
      break;
    }
    pageUrl = nextUrl;
  }
  return postings;
}

async function acquireExpandingPage(
  page: Page,
  initialUrl: string,
  config: ScraperConfig,
): Promise<RawPosting[]> {
  await navigate(page, initialUrl);
  await page.waitForSelector(config.listSelector);
  if (config.pagination.type === 'load-more-button') {
    const selector = config.pagination.value;
    if (!selector) {
      throw new AdapterError('load-more-button pagination requires a selector value.');
    }
    for (let round = 1; round < config.pagination.maxPages; round += 1) {
      const button = page.locator(selector).first();
      if ((await button.count()) === 0 || !(await button.isVisible())) {
        break;
      }
      await button.click();
      await page.waitForLoadState('networkidle');
    }
  } else {
    let previousHeight = await documentHeight(page);
    for (let round = 1; round < config.pagination.maxPages; round += 1) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(250);
      await page.waitForLoadState('networkidle');
      const nextHeight = await documentHeight(page);
      if (nextHeight === previousHeight) {
        break;
      }
      previousHeight = nextHeight;
    }
  }
  return extractPostings(load(await page.content()), config, page.url());
}

async function navigate(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' });
}

async function browserNextPageUrl(
  page: Page,
  config: ScraperConfig,
  nextPage: number,
): Promise<string | null> {
  switch (config.pagination.type) {
    case 'none':
      return null;
    case 'next-link': {
      const selector = config.pagination.value;
      if (!selector) {
        return null;
      }
      const link = page.locator(selector).first();
      const href = (await link.count()) > 0 ? await link.getAttribute('href') : null;
      return href ? new URL(href, page.url()).toString() : null;
    }
    case 'url-param': {
      const template = config.pagination.value;
      if (!template?.includes('{n}')) {
        throw new AdapterError('url-param pagination value must contain {n}.');
      }
      return new URL(template.replaceAll('{n}', String(nextPage)), page.url()).toString();
    }
    case 'load-more-button':
    case 'infinite-scroll':
      return null;
  }
}

async function documentHeight(page: Page): Promise<number> {
  return page.evaluate(() => document.body.scrollHeight);
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
  const selected =
    field.selector === ':scope' ? $(element) : $(element).find(field.selector).first();
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
