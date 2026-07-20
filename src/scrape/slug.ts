/** Pure encoding and validation for composite ATS slugs. */
import { AdapterError } from '../util/errors.js';

export interface WorkdaySlugParts {
  tenant: string;
  instance: string;
  site: string;
}

const WORKDAY_PART = /^[a-z0-9][a-z0-9-]*$/i;
const WORKDAY_INSTANCE = /^wd\d+$/i;

/** Encodes the three Workday routing components into the database slug column. */
export function encodeWorkdaySlug(parts: WorkdaySlugParts): string {
  validateParts(parts);
  return `${parts.tenant}|${parts.instance.toLowerCase()}|${parts.site}`;
}

/** Decodes a Workday database slug, rejecting incomplete or unsafe routing data. */
export function decodeWorkdaySlug(slug: string): WorkdaySlugParts {
  const [tenant, instance, site, extra] = slug.split('|');
  if (!tenant || !instance || !site || extra !== undefined) {
    throw new AdapterError(`Malformed Workday slug: ${slug}`);
  }
  const parts = { tenant, instance: instance.toLowerCase(), site };
  validateParts(parts);
  return parts;
}

function validateParts(parts: WorkdaySlugParts): void {
  if (
    !WORKDAY_PART.test(parts.tenant) ||
    !WORKDAY_INSTANCE.test(parts.instance) ||
    !WORKDAY_PART.test(parts.site)
  ) {
    throw new AdapterError(
      `Malformed Workday slug parts: ${parts.tenant}|${parts.instance}|${parts.site}`,
    );
  }
}
