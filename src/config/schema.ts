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

/** SMTP delivery settings; the environment password is resolved outside the schema. */
export const EmailConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    to: z.string().trim().default(''),
    from: z.string().trim().default(''),
    smtp: z
      .object({
        host: z.string().trim().default('smtp.gmail.com'),
        port: z.number().int().min(1).max(65_535).default(465),
        user: z.string().trim().default(''),
        password: z.string().default(''),
      })
      .default({ host: 'smtp.gmail.com', port: 465, user: '', password: '' }),
  })
  .superRefine((email, context) => {
    if (!email.enabled) {
      return;
    }
    for (const [path, value] of [
      ['to', email.to],
      ['from', email.from],
      ['smtp.host', email.smtp.host],
      ['smtp.user', email.smtp.user],
    ] as const) {
      if (!value) {
        context.addIssue({ code: 'custom', path: path.split('.'), message: 'is required' });
      }
    }
  })
  .default({
    enabled: false,
    to: '',
    from: '',
    smtp: { host: 'smtp.gmail.com', port: 465, user: '', password: '' },
  });

/** Validated SMTP digest-delivery settings. */
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

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
  email: EmailConfigSchema,
  ai: AiConfigSchema,
  stats: z
    .object({
      /** Applications quiet at least this many days (and not offer/rejected) get a nudge. */
      followUpDays: z.number().int().positive().default(7),
      /** Applications quiet at least this many days are flagged stale instead of nudged. */
      staleDays: z.number().int().positive().default(21),
      /** A keyword needs at least this many linked applications before its rate is shown. */
      minKeywordSample: z.number().int().min(1).default(2),
      /** A résumé version needs at least this many applications before it's not low-signal. */
      minResumeSample: z.number().int().min(1).default(3),
    })
    .default({
      followUpDays: 7,
      staleDays: 21,
      minKeywordSample: 2,
      minResumeSample: 3,
    }),
});

/** Validated main application settings. */
export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Validated `stats` thresholds. */
export type StatsConfig = AppConfig['stats'];

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

/**
 * Binary disqualifiers, distinct from `negative` (which only scores). Defaults are permissive —
 * empty lists and an empty allow-list mean no filtering — so existing behavior is unchanged
 * until a user opts in by populating these.
 */
const HardExcludeSchema = z
  .object({
    title: z.array(z.string()).default([]),
    description: z.array(z.string()).default([]),
  })
  .default({ title: [], description: [] });

const LocationsSchema = z
  .object({
    allow: z.array(z.string()).default([]),
    block: z.array(z.string()).default([]),
    allowUnknownLocation: z.boolean().default(true),
  })
  .default({ allow: [], block: [], allowUnknownLocation: true });

/** Weighted job-scoring keyword groups, plus the hard-exclude/location suppression gate. */
export const KeywordsFileSchema = z.object({
  title: KeywordWeightsSchema,
  description: KeywordWeightsSchema,
  negative: KeywordWeightsSchema,
  hardExclude: HardExcludeSchema,
  locations: LocationsSchema,
});

/** Validated keyword scoring profile. */
export type KeywordsFile = z.infer<typeof KeywordsFileSchema>;
