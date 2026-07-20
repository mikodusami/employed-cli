/** Validated manual ATS overrides consulted before network detection. */
import { z } from 'zod';

export const ScrapeMethodSchema = z.enum([
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'smartrecruiters',
  'recruitee',
  'generated-static',
  'generated-playwright',
  'unknown',
  'manual',
]);

export const KnownAtsSchema = z.record(
  z.string(),
  z.object({
    method: ScrapeMethodSchema,
    slug: z.string().trim().min(1),
  }),
);

export type KnownAtsFile = z.infer<typeof KnownAtsSchema>;
