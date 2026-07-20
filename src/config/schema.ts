/** Defines and types every user-editable YAML configuration file. */
import { z } from 'zod';

const ProviderNameSchema = z.enum(['claude', 'codex']);

const ProviderSettingsSchema = z.object({
  enabled: z.boolean().default(true),
});

/**
 * Controls AI availability, provider preference, and the shared per-run budget.
 *
 * @remarks Disabling `enabled`, or disabling every provider, puts employed in AI-free degraded
 * mode without affecting non-AI features. Enabled providers are attempted in preference order;
 * later providers are fallbacks when an earlier binary is unavailable or fails.
 */
export const AiConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    preference: z.array(ProviderNameSchema).default(['claude', 'codex']),
    providers: z
      .object({
        claude: ProviderSettingsSchema.default({ enabled: true }),
        codex: ProviderSettingsSchema.default({ enabled: true }),
      })
      .default({ claude: { enabled: true }, codex: { enabled: true } }),
    maxCallsPerRun: z.number().int().min(0).default(10),
  })
  .superRefine(({ preference }, context) => {
    if (new Set(preference).size !== preference.length) {
      context.addIssue({
        code: 'custom',
        path: ['preference'],
        message: 'AI provider preference entries must be unique.',
      });
    }
  })
  .default({
    enabled: true,
    preference: ['claude', 'codex'],
    providers: { claude: { enabled: true }, codex: { enabled: true } },
    maxCallsPerRun: 10,
  });

/** Validated AI provider settings. */
export type AiConfig = z.infer<typeof AiConfigSchema>;

/** AI coding-agent CLI supported by employed. */
export type ProviderName = z.infer<typeof ProviderNameSchema>;

/** Main application settings and their forward-compatible defaults. */
export const AppConfigSchema = z.object({
  run: z
    .object({
      time: z.string().regex(/^\d{2}:\d{2}$/, 'must use HH:MM format').default('07:00'),
      concurrency: z.number().int().min(1).max(10).default(4),
      jitterMs: z
        .object({
          min: z.number().int().nonnegative().default(500),
          max: z.number().int().nonnegative().default(1500),
        })
        .refine(({ min, max }) => min <= max, 'minimum jitter must not exceed maximum jitter')
        .default({ min: 500, max: 1500 }),
      maxRetries: z.number().int().min(1).max(10).default(3),
      respectRobots: z.boolean().default(true),
      autoGenerateOnAdd: z.boolean().default(true),
      heal: z
        .object({
          maxPerCompany: z.number().int().min(0).default(2),
          maxPerRun: z.number().int().min(0).default(5),
        })
        .default({ maxPerCompany: 2, maxPerRun: 5 }),
      playwright: z
        .object({
          navTimeoutMs: z.number().int().positive().default(30_000),
        })
        .default({ navTimeoutMs: 30_000 }),
    })
    .default({
      time: '07:00',
      concurrency: 4,
      jitterMs: { min: 500, max: 1500 },
      maxRetries: 3,
      respectRobots: true,
      autoGenerateOnAdd: true,
      heal: { maxPerCompany: 2, maxPerRun: 5 },
      playwright: { navTimeoutMs: 30_000 },
    }),
  email: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
  ai: AiConfigSchema,
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
        url: z.string().trim().min(1),
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
