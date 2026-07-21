/** Pure conversion of captured evidence into a compact AI planning packet. */
import { load } from 'cheerio';

import type { CaptureResult, NetworkEntry } from './capture/index.js';
import { distillDom } from './distill.js';

export interface LinkPattern {
  pattern: string;
  count: number;
  examples: string[];
}

export interface AnalysisPacket {
  distilledDom: string;
  networkSummary: string;
  linkPatterns: LinkPattern[];
  navigationPath: string[];
}

export function analyzeCapture(capture: CaptureResult): AnalysisPacket {
  return {
    distilledDom: distillDom(capture.html).dom,
    networkSummary: summarizeNetwork(capture.networkLog),
    linkPatterns: mapLinks(capture.html, capture.finalUrl),
    navigationPath: [...capture.navigationPath],
  };
}

export function summarizeNetwork(log: readonly NetworkEntry[]): string {
  if (log.length === 0) {
    return 'No JSON-like XHR/fetch responses were captured.';
  }
  return log
    .map(
      (entry, index) =>
        `[${index + 1}] ${entry.method} ${entry.url}\n` +
        `status=${entry.status} content-type=${entry.contentType ?? 'unknown'}\n` +
        `${entry.requestBody ? `request=${entry.requestBody}\n` : ''}` +
        `response=${entry.responsePreview}`,
    )
    .join('\n\n');
}

export function mapLinks(html: string, baseUrl: string): LinkPattern[] {
  const $ = load(html);
  const groups = new Map<string, string[]>();
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href');
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href)) {
      return;
    }
    try {
      const url = new URL(href, baseUrl);
      const pattern = shapePath(url.pathname);
      const examples = groups.get(pattern) ?? [];
      if (!examples.includes(url.toString())) {
        examples.push(url.toString());
      }
      groups.set(pattern, examples);
    } catch {
      return;
    }
  });
  return [...groups]
    .filter(([, examples]) => examples.length >= 2)
    .map(([pattern, examples]) => ({ pattern, count: examples.length, examples: examples.slice(0, 3) }))
    .sort((left, right) => right.count - left.count || left.pattern.localeCompare(right.pattern))
    .slice(0, 10);
}

function shapePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      if (/^\d+$/.test(segment)) {
        return '{id}';
      }
      if (/^[0-9a-f]{8,}$/i.test(segment)) {
        return '{id}';
      }
      return segment;
    })
    .join('/');
}
