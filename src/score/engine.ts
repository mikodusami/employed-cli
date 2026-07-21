/** Pure weighted, word-boundary-aware scoring for one normalized or raw job posting. */
import type { KeywordsFile } from '../config/schema.js';
import type { Band } from '../db/types.js';

export const TITLE_MULTIPLIER = 2;
export const DESCRIPTION_MULTIPLIER = 1;
export const NEGATIVE_MULTIPLIER = -2;

export const BAND_THRESHOLDS = {
  A: 30,
  B: 18,
  C: 8,
} as const;

export interface ScoreResult {
  score: number;
  band: Band;
  matchedKeywords: string[];
  titleOnly: boolean;
}

/**
 * Builds a case-insensitive, word-boundary-aware matcher for one keyword.
 *
 * @remarks `\b` is defined relative to `\w` (letters, digits, underscore), not relative to the
 * keyword's own characters — so a keyword containing a non-word character at its edge, like
 * `ci/cd`, still matches correctly: the boundary applies where the keyword touches the
 * surrounding text (start/end of string or a transition to/from a word character), not inside
 * the keyword itself. This is shared by title/description/negative matching (`weightedMatches`
 * below) and the hard-exclude/location filter (`score/filter.ts`) — one matcher for the layer.
 */
export function buildKeywordRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

/** Scores a job without I/O, persistence, clocks, or provider calls. */
export function scoreJob(
  job: { title: string; description?: string | null },
  keywords: KeywordsFile,
): ScoreResult {
  const title = job.title.toLowerCase();
  const description = job.description?.trim().toLowerCase() ?? '';
  const combined = `${title}\n${description}`;
  const matches = new Set<string>();

  const titleScore = weightedMatches(title, keywords.title, TITLE_MULTIPLIER, matches);
  const descriptionScore = weightedMatches(
    description,
    keywords.description,
    DESCRIPTION_MULTIPLIER,
    matches,
  );
  // Deliberately penalize negative signals found in either title or description.
  const negativeScore = weightedMatches(
    combined,
    keywords.negative,
    NEGATIVE_MULTIPLIER,
    matches,
  );
  const score = titleScore + descriptionScore + negativeScore;
  return {
    score,
    band: bandForScore(score),
    matchedKeywords: [...matches],
    titleOnly: description.length === 0,
  };
}

function weightedMatches(
  text: string,
  keywords: Readonly<Record<string, number>>,
  multiplier: number,
  matches: Set<string>,
): number {
  let subtotal = 0;
  for (const [keyword, weight] of Object.entries(keywords)) {
    if (buildKeywordRegex(keyword).test(text)) {
      subtotal += weight * multiplier;
      matches.add(keyword);
    }
  }
  return subtotal;
}

function bandForScore(score: number): Band {
  if (score >= BAND_THRESHOLDS.A) {
    return 'A';
  }
  if (score >= BAND_THRESHOLDS.B) {
    return 'B';
  }
  if (score >= BAND_THRESHOLDS.C) {
    return 'C';
  }
  return 'D';
}
