/** Pure normalization and deduplication rules for every posting source. */
import { createHash } from 'node:crypto';

import type { JobInsertInput } from '../db/index.js';
import type { RawPosting } from './types.js';

const REQUIREMENT_ID_PATTERN = /\(?(?:req|id|r-)[\s:#-]*\w+\)?/gi;

/** Produces a stable lowercase title without source-specific requirement IDs. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(REQUIREMENT_ID_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Uses an ATS-native ID when present, otherwise hashes normalized title and URL path. */
export function computeDedupeKey(posting: RawPosting): string {
  if (posting.externalId !== null && posting.externalId !== undefined) {
    return posting.externalId;
  }
  const urlPath = new URL(posting.url).pathname;
  return createHash('sha256').update(normalizeTitle(posting.title) + urlPath).digest('hex');
}

/** Converts a raw source posting into the repository's canonical insert shape. */
export function toJobInput(
  posting: RawPosting,
  companyId: number,
  today: string,
): JobInsertInput {
  const url = new URL(posting.url);
  url.hash = '';
  return {
    company_id: companyId,
    title: posting.title.trim(),
    url: url.toString(),
    location: trimOptional(posting.location),
    department: trimOptional(posting.department),
    description: trimOptional(posting.description),
    first_seen: today,
    last_seen: today,
    dedupe_key: computeDedupeKey(posting),
  };
}

function trimOptional(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
