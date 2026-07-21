/** Bounded evidence capture for generated-scraper planning. */
import type { Page, Response } from 'playwright';

import { CaptureTimeoutError } from '../../util/errors.js';
import type { HttpClient } from '../../util/http.js';
import { BrowserPool } from '../browser.js';
import { findJobBrowseLinks, findJobDetailLinks } from '../crawl.js';

export type CaptureStrategy = 'static' | 'playwright' | 'playwright-network';

export interface NetworkEntry {
  method: string;
  url: string;
  requestBody: string | null;
  responsePreview: string;
  contentType: string | null;
  status: number;
}

export interface CaptureResult {
  strategy: CaptureStrategy;
  finalUrl: string;
  html: string;
  networkLog: NetworkEntry[];
  navigationPath: string[];
}

export interface CaptureDeadlines {
  staticDeadlineMs: number;
  playwrightDeadlineMs: number;
}

/** Captures one page using the selected strategy under an absolute deadline. */
export async function capturePage(
  strategy: CaptureStrategy,
  url: string,
  http: HttpClient,
  browsers: BrowserPool | undefined,
  deadlines: CaptureDeadlines,
): Promise<CaptureResult> {
  if (strategy === 'static') {
    return withDeadline(captureStatic(url, http), deadlines.staticDeadlineMs, strategy);
  }
  if (!browsers) {
    throw new CaptureTimeoutError('Browser capture is unavailable in this runtime.');
  }
  return browsers.page(
    (page) => captureBrowser(page, url, strategy === 'playwright-network'),
    deadlines.playwrightDeadlineMs,
  );
}

async function captureStatic(url: string, http: HttpClient): Promise<CaptureResult> {
  const response = await http.fetchText(url);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Static capture received HTTP ${response.status}.`);
  }
  return {
    strategy: 'static',
    finalUrl: response.finalUrl,
    html: response.body,
    networkLog: [],
    navigationPath: [response.finalUrl],
  };
}

async function captureBrowser(
  page: Page,
  initialUrl: string,
  recordNetwork: boolean,
): Promise<CaptureResult> {
  const entries: NetworkEntry[] = [];
  const pendingResponses: Promise<void>[] = [];
  if (recordNetwork) {
    page.on('response', (response) => {
      pendingResponses.push(recordResponse(response, entries));
    });
  }

  const navigationPath = [initialUrl];
  await page.goto(initialUrl, { waitUntil: 'networkidle' });
  for (let hop = 0; hop < 2; hop += 1) {
    const html = await page.content();
    if (findJobDetailLinks(html, page.url()).length >= 3) {
      break;
    }
    const next = findJobBrowseLinks(html, page.url()).find(
      (candidate) => !navigationPath.includes(candidate),
    );
    if (!next) {
      break;
    }
    await page.goto(next, { waitUntil: 'networkidle' });
    navigationPath.push(page.url());
  }

  if (recordNetwork) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await Promise.allSettled(pendingResponses);
  }

  return {
    strategy: recordNetwork ? 'playwright-network' : 'playwright',
    finalUrl: page.url(),
    html: await page.content(),
    networkLog: entries.slice(0, 30),
    navigationPath,
  };
}

async function recordResponse(response: Response, entries: NetworkEntry[]): Promise<void> {
  if (entries.length >= 30) {
    return;
  }
  const request = response.request();
  if (!['xhr', 'fetch'].includes(request.resourceType())) {
    return;
  }
  const contentType = response.headers()['content-type'] ?? null;
  let body: string;
  try {
    body = await response.text();
  } catch {
    return;
  }
  const trimmed = body.trimStart();
  if (!contentType?.toLowerCase().includes('json') && !/^[{[]/.test(trimmed)) {
    return;
  }
  entries.push({
    method: request.method(),
    url: response.url(),
    requestBody: truncate(request.postData(), 2_048),
    responsePreview: truncate(body, 4_096) ?? '',
    contentType,
    status: response.status(),
  });
}

function truncate(value: string | null, limit: number): string | null {
  if (value === null) {
    return null;
  }
  return value.length <= limit ? value : value.slice(0, limit);
}

async function withDeadline<Result>(
  operation: Promise<Result>,
  deadlineMs: number,
  strategy: CaptureStrategy,
): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new CaptureTimeoutError(`${strategy} capture exceeded ${deadlineMs}ms deadline.`)),
      deadlineMs,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
