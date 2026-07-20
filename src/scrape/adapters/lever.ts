/** Adapts Lever's public postings API to canonical raw postings. */
import { z, ZodError } from 'zod';

import type { CompanyRow } from '../../db/index.js';
import { AdapterError } from '../../util/errors.js';
import { stripHtmlTags } from '../../util/html.js';
import type { HttpClient } from '../../util/http.js';
import type { RawPosting, ScrapeSource } from '../types.js';

const LeverResponseSchema = z.array(
  z
    .object({
      id: z.union([z.string(), z.number()]),
      text: z.string(),
      hostedUrl: z.string(),
      categories: z
        .object({
          location: z.string().nullish(),
          team: z.string().nullish(),
        })
        .passthrough()
        .nullish(),
      descriptionPlain: z.string().nullish(),
      description: z.string().nullish(),
    })
    .passthrough(),
);

/** Fetches and maps postings from a Lever site. */
export class LeverAdapter implements ScrapeSource {
  public readonly method = 'lever' as const;

  public constructor(private readonly http: HttpClient) {}

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    if (!company.slug) {
      throw new AdapterError(`Lever company ${company.name} has no board slug.`);
    }
    const endpoint =
      `https://api.lever.co/v0/postings/${encodeURIComponent(company.slug)}` + '?mode=json';
    const response = await this.http.fetchText(endpoint);
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterError(`Lever returned HTTP ${response.status} for ${company.name}.`);
    }

    try {
      const jobs = LeverResponseSchema.parse(JSON.parse(response.body));
      return jobs.map((job) => ({
        title: job.text,
        url: job.hostedUrl,
        location: job.categories?.location ?? null,
        department: job.categories?.team ?? null,
        description: getDescription(job.descriptionPlain, job.description),
        externalId: String(job.id),
      }));
    } catch (error: unknown) {
      throw toAdapterError(company.name, error);
    }
  }
}

function getDescription(plainText?: string | null, html?: string | null): string | null {
  if (plainText) {
    return plainText.trim();
  }
  return html ? stripHtmlTags(html) : null;
}

function toAdapterError(companyName: string, error: unknown): AdapterError {
  if (error instanceof ZodError) {
    const details = error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    return new AdapterError(`Lever response invalid for ${companyName}: ${details}`, {
      cause: error,
    });
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new AdapterError(`Lever response invalid for ${companyName}: ${reason}`, { cause: error });
}
