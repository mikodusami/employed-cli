/** Adapts Ashby's public job-board API to canonical raw postings. */
import { z, ZodError } from 'zod';

import type { CompanyRow } from '../../db/index.js';
import { AdapterError } from '../../util/errors.js';
import { stripHtmlTags } from '../../util/html.js';
import type { HttpClient } from '../../util/http.js';
import type { RawPosting, ScrapeSource } from '../types.js';

const AshbyEnvelopeSchema = z.object({
  jobs: z.array(
    z
      .object({
        id: z.union([z.string(), z.number()]),
        title: z.string(),
        jobUrl: z.string().nullish(),
        applyUrl: z.string().nullish(),
        location: z.string().nullish(),
        department: z.string().nullish(),
        team: z.string().nullish(),
        descriptionPlain: z.string().nullish(),
        descriptionHtml: z.string().nullish(),
      })
      .passthrough()
      .refine((job) => Boolean(job.jobUrl ?? job.applyUrl), {
        message: 'jobUrl or applyUrl is required',
      }),
  ),
});

/** Fetches and maps postings from an Ashby board. */
export class AshbyAdapter implements ScrapeSource {
  public readonly method = 'ashby' as const;

  public constructor(private readonly http: HttpClient) {}

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    if (!company.slug) {
      throw new AdapterError(`Ashby company ${company.name} has no board slug.`);
    }
    const endpoint =
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.slug)}`;
    const response = await this.http.fetchText(endpoint);
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError(`Ashby returned HTTP ${response.status} for ${company.name}.`);
    }

    try {
      const envelope = AshbyEnvelopeSchema.parse(JSON.parse(response.body));
      return envelope.jobs.map((job) => ({
        title: job.title,
        url: job.jobUrl ?? job.applyUrl ?? '',
        location: job.location ?? null,
        department: job.department ?? job.team ?? null,
        description:
          job.descriptionPlain?.trim() ??
          (job.descriptionHtml ? stripHtmlTags(job.descriptionHtml) : null),
        externalId: String(job.id),
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
    return new AdapterError(`Ashby response invalid for ${companyName}: ${details}`, {
      cause: error,
    });
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new AdapterError(`Ashby response invalid for ${companyName}: ${reason}`, { cause: error });
}
