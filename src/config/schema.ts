/** Defines and types every user-editable YAML configuration file. */
import { z } from 'zod';

/** Main application settings and their forward-compatible defaults. */
export const AppConfigSchema = z.object({
  run: z
    .object({
      time: z.string().regex(/^\d{2}:\d{2}$/, 'must use HH:MM format').default('07:00'),
      concurrency: z.number().int().min(1).max(10).default(4),
    })
    .default({ time: '07:00', concurrency: 4 }),
  email: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
  ai: z
    .object({
      provider: z.enum(['claude', 'codex', 'chatgpt']).default('claude'),
      enabled: z.boolean().default(true),
      maxCallsPerRun: z.number().int().min(0).default(10),
    })
    .default({ provider: 'claude', enabled: true, maxCallsPerRun: 10 }),
});

/** Validated main application settings. */
export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Company priority used by the editable watch list. */
export const CompanyTierSchema = z.enum(['A', 'B', 'C']);

/** Company watch-list settings and entries. */
export const CompaniesFileSchema = z.object({
  defaults: z
    .object({
      tier: CompanyTierSchema.default('B'),
    })
    .default({ tier: 'B' }),
  companies: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        url: z.url(),
        tier: CompanyTierSchema.optional(),
      }),
    )
    .default([]),
});

/** Validated company watch-list file. */
export type CompaniesFile = z.infer<typeof CompaniesFileSchema>;

const KeywordWeightsSchema = z.record(z.string(), z.number()).default({});

/** Weighted job-scoring keyword groups. */
export const KeywordsFileSchema = z.object({
  title: KeywordWeightsSchema,
  description: KeywordWeightsSchema,
  negative: KeywordWeightsSchema,
});

/** Validated keyword scoring profile. */
export type KeywordsFile = z.infer<typeof KeywordsFileSchema>;
