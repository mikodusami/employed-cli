/** Adapts SmartRecruiters' paginated posting API to canonical raw postings. */
import { z, ZodError } from 'zod';

import type { CompanyRow } from '../../db/index.js';
import { AdapterError } from '../../util/errors.js';
import type { HttpClient } from '../../util/http.js';
import type { RawPosting, ScrapeSource } from '../types.js';

const MAX_PAGES = 5;
const PAGE_LIMIT = 100;

const SmartRecruitersEnvelopeSchema = z.object({
  content: z.array(
    z
      .object({
        id: z.union([z.string(), z.number()]),
        name: z.string(),
        location: z
          .object({ city: z.string().nullish(), country: z.string().nullish() })
          .passthrough()
          .nullish(),
        // Ubisoft2 returns department objects containing an id but no label.
        department: z.object({ label: z.string().optional() }).passthrough().nullish(),
      })
      .passthrough(),
  ),
  totalFound: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

/** Fetches all bounded pages from a SmartRecruiters company board. */
export class SmartRecruitersAdapter implements ScrapeSource {
  public readonly method = 'smartrecruiters' as const;

  public constructor(private readonly http: HttpClient) {}

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    if (!company.slug) {
      throw new AdapterError(`SmartRecruiters company ${company.name} has no board slug.`);
    }

    const postings: RawPosting[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const offset = page * PAGE_LIMIT;
      const endpoint =
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.slug)}` +
        `/postings?limit=${PAGE_LIMIT}&offset=${offset}`;
      const response = await this.http.fetchText(endpoint);
      if (response.status < 200 || response.status >= 300) {
        throw new AdapterError(
          `SmartRecruiters returned HTTP ${response.status} for ${company.name}.`,
        );
      }

      const envelope = parseEnvelope(company.name, response.body);
      postings.push(...envelope.content.map((posting) => mapPosting(company.slug ?? '', posting)));
      if (envelope.content.length === 0 || envelope.offset + envelope.limit >= envelope.totalFound) {
        break;
      }
    }
    return postings;
  }
}

type SmartRecruitersPosting = z.infer<typeof SmartRecruitersEnvelopeSchema>['content'][number];

function mapPosting(companySlug: string, posting: SmartRecruitersPosting): RawPosting {
  return {
    title: posting.name,
    // Verified against Visa: the stable public route redirects to the current canonical posting URL.
    url:
      `https://jobs.smartrecruiters.com/${encodeURIComponent(companySlug)}/` +
      encodeURIComponent(String(posting.id)),
    location: formatLocation(posting.location?.city, posting.location?.country),
    department: posting.department?.label ?? null,
    description: null,
    externalId: String(posting.id),
  };
}

function formatLocation(city?: string | null, country?: string | null): string | null {
  const parts = [city, country].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(', ') : null;
}

function parseEnvelope(
  companyName: string,
  body: string,
): z.infer<typeof SmartRecruitersEnvelopeSchema> {
  try {
    return SmartRecruitersEnvelopeSchema.parse(JSON.parse(body));
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new AdapterError(
        `SmartRecruiters response invalid for ${companyName}: ${details}`,
        { cause: error },
      );
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new AdapterError(`SmartRecruiters response invalid for ${companyName}: ${reason}`, {
      cause: error,
    });
  }
}
