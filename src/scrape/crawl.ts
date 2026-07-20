/** Pure, bounded candidate-link discovery for shallow ATS reconnaissance. */
import { load } from 'cheerio';

export interface CrawlCandidateFinder {
  findCandidateLinks(html: string, baseUrl: string): string[];
}

const BROWSE_SIGNAL = /jobs|careers|positions|openings|search|opportunities/i;
const DETAIL_SIGNAL = /\/jobs?\/\d+|\/positions?\/[\w-]+/i;
const SOCIAL_HOST = /(^|\.)(facebook|instagram|linkedin|tiktok|twitter|x)\.com$/i;
const MAX_BROWSE_LINKS = 2;
const MAX_DETAIL_LINKS = 3;

interface LinkCandidate {
  url: string;
  text: string;
  score: number;
  index: number;
}

export function findJobBrowseLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  return collectLinks(html, baseUrl)
    .filter((candidate) => BROWSE_SIGNAL.test(candidate.url) || BROWSE_SIGNAL.test(candidate.text))
    .map((candidate) => ({
      ...candidate,
      score:
        Number(BROWSE_SIGNAL.test(new URL(candidate.url).pathname)) * 4 +
        Number(BROWSE_SIGNAL.test(candidate.text)) * 2 +
        Number(new URL(candidate.url).origin === base.origin),
    }))
    .sort(compareCandidates)
    .slice(0, MAX_BROWSE_LINKS)
    .map((candidate) => candidate.url);
}

export function findJobDetailLinks(html: string, baseUrl: string): string[] {
  const links = collectLinks(html, baseUrl);
  const prefixCounts = new Map<string, number>();
  for (const link of links) {
    const prefix = pathPrefix(new URL(link.url).pathname);
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }
  return links
    .map((candidate) => {
      const pathname = new URL(candidate.url).pathname;
      const repeated = (prefixCounts.get(pathPrefix(pathname)) ?? 0) >= 3;
      return {
        ...candidate,
        score:
          Number(DETAIL_SIGNAL.test(pathname)) * 10 +
          Number(repeated) * 3 +
          Number(/job|position|role/i.test(candidate.text)),
      };
    })
    .filter((candidate) => candidate.score >= 3)
    .sort(compareCandidates)
    .slice(0, MAX_DETAIL_LINKS)
    .map((candidate) => candidate.url);
}

function collectLinks(html: string, baseUrl: string): LinkCandidate[] {
  const $ = load(html);
  const current = canonicalUrl(baseUrl);
  const seen = new Set<string>();
  const candidates: LinkCandidate[] = [];
  $('a[href]').each((index, element) => {
    const href = $(element).attr('href')?.trim();
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href)) {
      return;
    }
    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(resolved.protocol) || SOCIAL_HOST.test(resolved.hostname)) {
      return;
    }
    resolved.hash = '';
    const url = resolved.toString();
    if (canonicalUrl(url) === current || seen.has(url)) {
      return;
    }
    seen.add(url);
    candidates.push({ url, text: $(element).text().replace(/\s+/g, ' ').trim(), score: 0, index });
  });
  return candidates;
}

function pathPrefix(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  return `/${segments.slice(0, Math.max(1, segments.length - 1)).join('/')}`;
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function compareCandidates(left: LinkCandidate, right: LinkCandidate): number {
  return right.score - left.score || left.index - right.index || left.url.localeCompare(right.url);
}
