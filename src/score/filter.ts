/**
 * Pure hard-exclude/location suppression gate — distinct from `scoreJob`'s soft scoring.
 *
 * @remarks Penalizing isn't suppressing: a senior or out-of-region posting can still outscore the
 * negative-keyword penalty and surface anyway. This gate removes a disqualifying job from reports
 * entirely. No DB/IO — fully fixture-testable, and reuses `buildKeywordRegex` so the same
 * word-boundary correctness applies here as it does to scoring.
 */
import type { KeywordsFile } from '../config/schema.js';
import { buildKeywordRegex } from './engine.js';

export interface FilterVerdict {
  excluded: boolean;
  reason: string | null;
}

export interface FilterableJob {
  title: string;
  description?: string | null;
  location?: string | null;
}

/**
 * Order matters: block always wins (checked first), then the allow-list, then hard-exclude
 * title/description. The first disqualifying match short-circuits the rest.
 */
export function applyHardFilters(
  job: FilterableJob,
  hardExclude: KeywordsFile['hardExclude'],
  locations: KeywordsFile['locations'],
): FilterVerdict {
  const location = job.location?.trim() ?? '';

  if (location) {
    const blocked = locations.block.find((pattern) => buildKeywordRegex(pattern).test(location));
    if (blocked) {
      return { excluded: true, reason: `location blocked: ${blocked}` };
    }
  }

  if (locations.allow.length > 0) {
    if (!location) {
      if (!locations.allowUnknownLocation) {
        return { excluded: true, reason: 'location unknown and not allowed' };
      }
    } else {
      const allowed = locations.allow.some((pattern) => buildKeywordRegex(pattern).test(location));
      if (!allowed) {
        return { excluded: true, reason: `location not in allow list: ${location}` };
      }
    }
  }

  const excludedTitle = hardExclude.title.find((pattern) =>
    buildKeywordRegex(pattern).test(job.title),
  );
  if (excludedTitle) {
    return { excluded: true, reason: `hard-exclude title: ${excludedTitle}` };
  }

  const description = job.description ?? '';
  const excludedDescription = hardExclude.description.find((pattern) =>
    buildKeywordRegex(pattern).test(description),
  );
  if (excludedDescription) {
    return { excluded: true, reason: `hard-exclude description: ${excludedDescription}` };
  }

  return { excluded: false, reason: null };
}
