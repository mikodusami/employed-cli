/** Pure validation gate for generated scraper output. */
import type { RawPosting } from './types.js';

const NAVIGATION_TITLE = /^(home|about|benefits|log ?in|search|careers)$/i;

export type ValidationVerdict =
  | { ok: true }
  | { ok: false; reasons: string[] };

/** Rejects empty, malformed, repetitive, or navigation-contaminated extraction results. */
export function validateExtraction(postings: RawPosting[]): ValidationVerdict {
  const reasons: string[] = [];
  if (postings.length === 0) {
    return { ok: false, reasons: ['Extraction returned no postings.'] };
  }

  if (postings.some((posting) => posting.title.trim().length === 0)) {
    reasons.push('Every posting must have a non-empty title.');
  }
  if (postings.some((posting) => !isAbsoluteUrl(posting.url))) {
    reasons.push('Every posting must have an absolute HTTP or HTTPS URL.');
  }

  const normalizedTitles = postings.map((posting) => posting.title.trim().toLowerCase());
  const duplicateCount = normalizedTitles.length - new Set(normalizedTitles).size;
  if (duplicateCount / postings.length >= 0.3) {
    reasons.push('Duplicate titles must account for less than 30% of postings.');
  }

  const lengths = postings.map((posting) => posting.title.trim().length).sort((a, b) => a - b);
  const median = medianValue(lengths);
  if (median < 8 || median > 80) {
    reasons.push(`Median title length must be 8–80 characters; received ${median}.`);
  }

  const navigationCount = postings.filter((posting) =>
    NAVIGATION_TITLE.test(posting.title.trim()),
  ).length;
  if (navigationCount / postings.length >= 0.2) {
    reasons.push('Navigation labels must account for less than 20% of titles.');
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function medianValue(sortedValues: readonly number[]): number {
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middle] ?? 0;
  }
  return ((sortedValues[middle - 1] ?? 0) + (sortedValues[middle] ?? 0)) / 2;
}
