/** Bounded ATS detection with override-first, multi-hop static reconnaissance. */
import type { ScrapeMethod } from '../db/index.js';
import { RobotsDisallowedError } from '../util/errors.js';
import type { FetchResult, HttpClient, RobotsGate } from '../util/http.js';
import { findJobBrowseLinks, findJobDetailLinks } from './crawl.js';
import type { KnownAtsFile } from './known-ats.js';
import { matchSignatures, type SignatureMatch } from './signatures.js';

export const MAX_DETECTION_REQUESTS = 5;

/** The company identity required for override lookup and crawl entry. */
export interface DetectionCompany {
  name: string;
  careers_url: string;
}

export interface DetectionResult {
  method: ScrapeMethod;
  slug: string | null;
  detail: string | null;
}

export interface AtsDetector {
  detect(company: DetectionCompany): Promise<DetectionResult>;
}

interface CrawledPage {
  finalUrl: string;
  body: string;
  path: readonly string[];
}

/** Fetches at most five static pages and classifies each with the pure signature matcher. */
export class SignatureDetector implements AtsDetector {
  private readonly knownAts: KnownAtsFile;

  public constructor(
    private readonly http: HttpClient,
    private readonly robots?: RobotsGate,
    private readonly respectRobots = false,
    knownAts: KnownAtsFile = {},
  ) {
    this.knownAts = Object.fromEntries(
      Object.entries(knownAts).map(([name, override]) => [name.toLowerCase(), override]),
    );
  }

  public async detect(company: DetectionCompany): Promise<DetectionResult> {
    const override = this.knownAts[company.name.toLowerCase()];
    if (override) {
      return { ...override, detail: 'known-ats override' };
    }

    let requestCount = 0;
    let lastFailure: string | null = null;
    const fetchPage = async (url: string, path: readonly string[]): Promise<CrawledPage | null> => {
      if (requestCount >= MAX_DETECTION_REQUESTS) {
        return null;
      }
      if (this.respectRobots && this.robots) {
        await this.robots.assertAllowed(url);
      }
      requestCount += 1;
      const result = await this.http.fetchText(url);
      if (!isSuccessful(result)) {
        lastFailure = `fetch failed: HTTP ${result.status}`;
        return null;
      }
      return { finalUrl: result.finalUrl, body: result.body, path: [...path, result.finalUrl] };
    };

    let root: CrawledPage;
    try {
      const page = await fetchPage(company.careers_url, []);
      if (!page) {
        return unknownResult(lastFailure ?? 'fetch failed: non-success response');
      }
      root = page;
    } catch (error: unknown) {
      return detectionError(error);
    }

    const rootMatch = matchSignatures(root.finalUrl, root.body);
    if (rootMatch) {
      return matchedResult(rootMatch, 0, root.path);
    }

    const depthOnePages: CrawledPage[] = [];
    for (const url of findJobBrowseLinks(root.body, root.finalUrl)) {
      const page = await safelyFetch(fetchPage, url, root.path);
      if (!page) {
        continue;
      }
      depthOnePages.push(page);
      const match = matchSignatures(page.finalUrl, page.body);
      if (match) {
        return matchedResult(match, 1, page.path);
      }
    }

    const detailSource = bestDetailSource(depthOnePages, root);
    for (const url of findJobDetailLinks(detailSource.body, detailSource.finalUrl)) {
      const page = await safelyFetch(fetchPage, url, detailSource.path);
      if (!page) {
        continue;
      }
      const match = matchSignatures(page.finalUrl, page.body);
      if (match) {
        return matchedResult(match, 2, page.path);
      }
    }

    return unknownResult(`no signature found after crawl (${requestCount} requests)`);
  }

}

async function safelyFetch(
  fetchPage: (url: string, path: readonly string[]) => Promise<CrawledPage | null>,
  url: string,
  path: readonly string[],
): Promise<CrawledPage | null> {
  try {
    return await fetchPage(url, path);
  } catch {
    return null;
  }
}

function bestDetailSource(pages: readonly CrawledPage[], fallback: CrawledPage): CrawledPage {
  if (pages.length === 0) {
    return fallback;
  }
  return pages.reduce((best, page) => {
    const candidateCount = findJobDetailLinks(page.body, page.finalUrl).length;
    const bestCount = findJobDetailLinks(best.body, best.finalUrl).length;
    return candidateCount > bestCount ? page : best;
  });
}

function matchedResult(
  match: SignatureMatch,
  depth: number,
  path: readonly string[],
): DetectionResult {
  return {
    method: match.method,
    slug: match.slug,
    detail: `matched at depth ${depth} via ${path.join(' -> ')}`,
  };
}

function isSuccessful(result: FetchResult): boolean {
  return result.status >= 200 && result.status < 300;
}

function detectionError(error: unknown): DetectionResult {
  if (error instanceof RobotsDisallowedError) {
    return { method: 'manual', slug: null, detail: error.message };
  }
  const reason = error instanceof Error ? error.message : String(error);
  return unknownResult(`fetch failed: ${reason}`);
}

function unknownResult(detail: string): DetectionResult {
  return { method: 'unknown', slug: null, detail };
}
