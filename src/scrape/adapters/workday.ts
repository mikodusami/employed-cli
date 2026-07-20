/** Adapts Workday's paginated CXS API to canonical raw postings. */
import { z, ZodError } from 'zod';

import type { CompanyRow } from '../../db/index.js';
import { AdapterError } from '../../util/errors.js';
import type { HttpClient } from '../../util/http.js';
import { decodeWorkdaySlug } from '../slug.js';
import type { RawPosting, ScrapeSource } from '../types.js';

const PAGE_LIMIT = 20;
const MAX_PAGES = 25;
const PAGE_DELAY_MS = 300;

const WorkdayEnvelopeSchema = z.object({
  total: z.number().int().nonnegative(),
  jobPostings: z.array(
    z
      .object({
        title: z.string(),
        externalPath: z.string(),
        locationsText: z.string().nullish(),
        bulletFields: z.array(z.string()).nullish(),
      })
      .passthrough(),
  ),
});

/** Fetches all bounded pages from a Workday CXS board. */
export class WorkdayAdapter implements ScrapeSource {
  public readonly method = 'workday' as const;

  public constructor(
    private readonly http: HttpClient,
    private readonly pageDelayMs = PAGE_DELAY_MS,
  ) {}

  public async fetchPostings(company: CompanyRow): Promise<RawPosting[]> {
    if (!company.slug) {
      throw new AdapterError(`Workday company ${company.name} has no board slug.`);
    }
    const parts = decodeWorkdaySlug(company.slug);
    const host = `${parts.tenant}.${parts.instance}.myworkdayjobs.com`;
    const endpoint = `https://${host}/wday/cxs/${parts.tenant}/${parts.site}/jobs`;
    const careersBase = `https://${host}/${encodeURIComponent(parts.site)}`;
    const postings: RawPosting[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const offset = page * PAGE_LIMIT;
      const response = await this.http.postJson(endpoint, {
        limit: PAGE_LIMIT,
        offset,
        searchText: '',
      });
      if (response.status < 200 || response.status >= 300) {
        throw new AdapterError(`Workday returned HTTP ${response.status} for ${company.name}.`);
      }

      const envelope = parseEnvelope(company.name, response.body);
      postings.push(...envelope.jobPostings.map((job) => mapPosting(careersBase, job)));
      if (
        envelope.jobPostings.length === 0 ||
        postings.length >= envelope.total ||
        page === MAX_PAGES - 1
      ) {
        break;
      }
      // TODO(politeness-unit): move inter-request spacing into the shared HTTP decorator.
      await delay(this.pageDelayMs);
    }
    return postings;
  }
}

type WorkdayPosting = z.infer<typeof WorkdayEnvelopeSchema>['jobPostings'][number];

function mapPosting(careersBase: string, posting: WorkdayPosting): RawPosting {
  return {
    title: posting.title,
    // NVIDIA, Salesforce, and Citi require the site segment before externalPath.
    url: `${careersBase}${posting.externalPath.startsWith('/') ? '' : '/'}${posting.externalPath}`,
    location: posting.locationsText ?? null,
    department: null,
    description: null,
    externalId: extractExternalId(posting),
  };
}

function extractExternalId(posting: WorkdayPosting): string | null {
  const bulletId = posting.bulletFields
    ?.map((field) => field.match(/(?:req(?:uisition)?|job)\s*(?:id)?\s*[:#-]?\s*([a-z0-9-]+)/i)?.[1])
    .find((value): value is string => Boolean(value));
  if (bulletId) {
    return bulletId;
  }
  const pathId = posting.externalPath.match(/_([a-z0-9-]+)\/?$/i)?.[1];
  return pathId ?? null;
}

function parseEnvelope(companyName: string, body: string): z.infer<typeof WorkdayEnvelopeSchema> {
  try {
    return WorkdayEnvelopeSchema.parse(JSON.parse(body));
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new AdapterError(`Workday response invalid for ${companyName}: ${details}`, {
        cause: error,
      });
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new AdapterError(`Workday response invalid for ${companyName}: ${reason}`, {
      cause: error,
    });
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
