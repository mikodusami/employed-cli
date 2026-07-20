/** Adapts Greenhouse's public job-board API to canonical raw postings. */
import { z, ZodError } from 'zod';

import type { CompanyRow } from '../../db/index.js';
import { AdapterError } from '../../util/errors.js';
import { stripHtmlTags } from '../../util/html.js';
import type { HttpClient } from '../../util/http.js';
import type { RawPosting, ScrapeSource } from '../types.js';

const GreenhouseEnvelopeSchema = z.object({
  jobs: z.array(
    z
      .object({
        id: z.union([z.string(), z.number()]),
        title: z.string(),
        absolute_url: z.string(),
        location: z.object({ name: z.string() }).passthrough().nullish(),
        departments: z
          .array(z.object({ name: z.string() }).passthrough())
          .nullish(),
        content: z.string().nullish(),
      })
      .passthrough(),
  ),
});

/** Fetches and maps postings from a Greenhouse board. */
export class GreenhouseAdapter implements ScrapeSource {
  public readonly method = 'greenhouse' as const;

  public constructor(private readonly http: HttpClient) {}

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    if (!company.slug) {
      throw new AdapterError(`Greenhouse company ${company.name} has no board slug.`);
    }
    const endpoint =
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.slug)}` +
      '/jobs?content=true';
    const response = await this.http.fetchText(endpoint);
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError(`Greenhouse returned HTTP ${response.status} for ${company.name}.`);
    }

    try {
      const envelope = GreenhouseEnvelopeSchema.parse(JSON.parse(response.body));
      return envelope.jobs.map((job) => ({
        title: job.title,
        url: job.absolute_url,
        location: job.location?.name ?? null,
        department: job.departments?.[0]?.name ?? null,
        description: job.content ? stripHtmlTags(job.content) : null,
        externalId: String(job.id),
      }));
    } catch (error: unknown) {
      throw toAdapterError('Greenhouse', company.name, error);
    }
  }
}

function toAdapterError(provider: string, companyName: string, error: unknown): AdapterError {
  if (error instanceof ZodError) {
    const details = error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    return new AdapterError(`${provider} response invalid for ${companyName}: ${details}`, {
      cause: error,
    });
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new AdapterError(`${provider} response invalid for ${companyName}: ${reason}`, {
    cause: error,
  });
}
