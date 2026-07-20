/** Canonical schema for AI-generated, data-only scraper configurations. */
import { z } from 'zod';

const FieldSelectorSchema = z.object({
  selector: z.string().min(1),
  attr: z.string().min(1),
});

const OptionalFieldSelectorSchema = FieldSelectorSchema.nullable();

export const ScraperConfigSchema = z.object({
  strategy: z.enum(['static', 'playwright']),
  listSelector: z.string().min(1),
  fields: z.object({
    title: FieldSelectorSchema,
    url: FieldSelectorSchema,
    location: OptionalFieldSelectorSchema,
    department: OptionalFieldSelectorSchema,
  }),
  pagination: z.object({
    type: z.enum(['none', 'next-link', 'url-param', 'load-more-button', 'infinite-scroll']),
    value: z.string().nullable(),
    maxPages: z.number().int().min(1).max(100),
  }),
  urlPrefix: z.string().url().nullable(),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
});

/** Validated generated scraper configuration. */
export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
