/** Pure weighted substring scoring for one normalized or raw job posting. */
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
    if (text.includes(keyword.toLowerCase())) {
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
