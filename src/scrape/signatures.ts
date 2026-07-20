/** Pure, ordered matching of ATS signatures in final URLs and HTML bodies. */
import type { ScrapeMethod } from '../db/index.js';

/** A supported ATS signature and its extracted board identifier. */
export interface SignatureMatch {
  method: ScrapeMethod;
  slug: string;
  detail: string;
}

interface SignatureRule {
  method: ScrapeMethod;
  urlPatterns: readonly RegExp[];
  htmlPatterns: readonly RegExp[];
  extractSlug(url: string, html: string): string | null;
}

const GREENHOUSE_URL = /(?:job-)?boards\.greenhouse\.io\/([^/?#"'\s]+)/i;
const GREENHOUSE_EMBED =
  /(?:job-)?boards\.greenhouse\.io\/embed\/job_board\/js\?[^"']*\bfor=([^&"']+)/i;
const LEVER_URL = /jobs\.lever\.co\/([^/?#"'\s]+)/i;
const ASHBY_URL = /jobs\.ashbyhq\.com\/([^/?#"'\s]+)/i;
const WORKDAY_URL =
  /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/)?([^/?#"'\s]+)/i;
const SMARTRECRUITERS_URL = /careers\.smartrecruiters\.com\/([^/?#"'\s]+)/i;
const RECRUITEE_URL = /https?:\/\/([a-z0-9-]+)\.recruitee\.com/i;

const signatureRules: readonly SignatureRule[] = [
  {
    method: 'greenhouse',
    urlPatterns: [/(?:job-)?boards\.greenhouse\.io/i],
    htmlPatterns: [/(?:job-)?boards\.greenhouse\.io/i, /grnhse/i],
    extractSlug: (url, html) =>
      extractCapture(GREENHOUSE_URL, url) ??
      extractCapture(GREENHOUSE_EMBED, html) ??
      extractCapture(GREENHOUSE_URL, html),
  },
  {
    method: 'lever',
    urlPatterns: [/jobs\.lever\.co/i],
    htmlPatterns: [/jobs\.lever\.co/i],
    extractSlug: (url, html) => extractCapture(LEVER_URL, url, html),
  },
  {
    method: 'ashby',
    urlPatterns: [/jobs\.ashbyhq\.com/i],
    htmlPatterns: [/jobs\.ashbyhq\.com/i],
    extractSlug: (url, html) => extractCapture(ASHBY_URL, url, html),
  },
  {
    method: 'workday',
    urlPatterns: [/\.wd\d+\.myworkdayjobs\.com/i],
    htmlPatterns: [/\.wd\d+\.myworkdayjobs\.com/i],
    extractSlug: (url, html) => {
      const match = firstMatch(WORKDAY_URL, url, html);
      if (!match?.[1] || !match[2] || !match[3]) {
        return null;
      }
      // Workday adapters decode this tenant|instance|site composite from the single DB slug.
      return `${match[1]}|${match[2].toLowerCase()}|${decodeSlug(match[3])}`;
    },
  },
  {
    method: 'smartrecruiters',
    urlPatterns: [/careers\.smartrecruiters\.com/i],
    htmlPatterns: [/careers\.smartrecruiters\.com/i],
    extractSlug: (url, html) => extractCapture(SMARTRECRUITERS_URL, url, html),
  },
  {
    method: 'recruitee',
    urlPatterns: [/\.recruitee\.com/i],
    htmlPatterns: [/\.recruitee\.com/i],
    extractSlug: (url, html) => extractCapture(RECRUITEE_URL, url, html),
  },
];

/** Returns the first supported ATS signature found in specification order. */
export function matchSignatures(finalUrl: string, html: string): SignatureMatch | null {
  for (const rule of signatureRules) {
    if (rule.urlPatterns.some((pattern) => pattern.test(finalUrl))) {
      const slug = rule.extractSlug(finalUrl, '');
      if (slug) {
        return {
          method: rule.method,
          slug,
          detail: `${rule.method} signature matched in final URL`,
        };
      }
    }

    if (rule.htmlPatterns.some((pattern) => pattern.test(html))) {
      const slug = rule.extractSlug('', html);
      if (slug) {
        return {
          method: rule.method,
          slug,
          detail: `${rule.method} signature matched in HTML`,
        };
      }
    }
  }
  return null;
}

function extractCapture(pattern: RegExp, ...sources: readonly string[]): string | null {
  const capture = firstMatch(pattern, ...sources)?.[1];
  return capture ? decodeSlug(capture) : null;
}

function firstMatch(pattern: RegExp, ...sources: readonly string[]): RegExpMatchArray | null {
  for (const source of sources) {
    const match = source.match(pattern);
    if (match) {
      return match;
    }
  }
  return null;
}

function decodeSlug(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
