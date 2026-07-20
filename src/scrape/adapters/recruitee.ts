/** Adapts Recruitee's public offers API to canonical raw postings. */
import { z, ZodError } from 'zod';

import type { CompanyRow } from '../../db/index.js';
import { AdapterError } from '../../util/errors.js';
import { stripHtmlTags } from '../../util/html.js';
import type { HttpClient } from '../../util/http.js';
import type { RawPosting, ScrapeSource } from '../types.js';

const DepartmentSchema = z.union([
  z.string(),
  z.object({ name: z.string() }).passthrough(),
]);

const RecruiteeEnvelopeSchema = z.object({
  offers: z.array(
    z
      .object({
        id: z.union([z.string(), z.number()]),
        title: z.string(),
        careers_url: z.string(),
        location: z.string().nullish(),
        department: DepartmentSchema.nullish(),
        description: z.string().nullish(),
      })
      .passthrough(),
  ),
});

/** Fetches and maps postings from a Recruitee careers site. */
export class RecruiteeAdapter implements ScrapeSource {
  public readonly method = 'recruitee' as const;

  public constructor(private readonly http: HttpClient) {}

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    if (!company.slug) {
      throw new AdapterError(`Recruitee company ${company.name} has no board slug.`);
    }
    const endpoint = `https://${company.slug}.recruitee.com/api/offers/`;
    const response = await this.http.fetchText(endpoint);
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError(`Recruitee returned HTTP ${response.status} for ${company.name}.`);
    }

    try {
      const envelope = RecruiteeEnvelopeSchema.parse(JSON.parse(response.body));
      return envelope.offers.map((offer) => ({
        title: offer.title,
        url: offer.careers_url,
        location: offer.location ?? null,
        department:
          typeof offer.department === 'string'
            ? offer.department
            : (offer.department?.name ?? null),
        description: offer.description ? stripHtmlTags(offer.description) : null,
        externalId: String(offer.id),
      }));
    } catch (error: unknown) {
      throw toAdapterError(company.name, error);
    }
  }
}

function toAdapterError(companyName: string, error: unknown): AdapterError {
  if (error instanceof ZodError) {
    const details = error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    return new AdapterError(`Recruitee response invalid for ${companyName}: ${details}`, {
      cause: error,
    });
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new AdapterError(`Recruitee response invalid for ${companyName}: ${reason}`, {
    cause: error,
  });
}
