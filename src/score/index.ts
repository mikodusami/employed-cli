/** Public scoring surface shared by scraping, reports, and analytics. */
export {
  BAND_THRESHOLDS,
  buildKeywordRegex,
  DESCRIPTION_MULTIPLIER,
  NEGATIVE_MULTIPLIER,
  scoreJob,
  TITLE_MULTIPLIER,
} from './engine.js';
export type { ScoreResult } from './engine.js';
export { applyHardFilters } from './filter.js';
export type { FilterVerdict } from './filter.js';
