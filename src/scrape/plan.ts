/** Versioned declarative plans accepted from AI and executed by hardened runtimes. */
import { z } from 'zod';

const PlanMetadataSchema = z.object({
  confidence: z.number().min(0).max(1),
  notes: z.string(),
  planVersion: z.literal(2),
});

const ApiHeadersSchema = z
  .record(z.string(), z.string())
  .default({})
  .superRefine((headers, context) => {
    for (const key of Object.keys(headers)) {
      if (!['accept', 'content-type'].includes(key.toLowerCase())) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'only accept and content-type headers are permitted',
        });
      }
    }
  });

export const ApiPlanSchema = z
  .object({
    mode: z.literal('api'),
    request: z.object({
      method: z.enum(['GET', 'POST']),
      urlTemplate: z.string().min(1),
      bodyTemplate: z.string().nullable(),
      headers: ApiHeadersSchema,
    }),
    response: z.object({
      itemsPath: z.string(),
      fields: z.object({
        title: z.string(),
        url: z.string(),
        location: z.string().nullable(),
        department: z.string().nullable(),
        externalId: z.string().nullable(),
      }),
      urlPrefix: z.string().nullable(),
      totalPath: z.string().nullable(),
    }),
    pagination: z.object({
      type: z.enum(['none', 'offset', 'page']),
      pageSize: z.number().int().positive().default(20),
      maxPages: z.number().int().min(1).max(25).default(10),
    }),
  })
  .merge(PlanMetadataSchema);

const FieldSelectorSchema = z.object({
  selector: z.string().min(1),
  attr: z.string().min(1),
});

export const DomPlanSchema = z
  .object({
    mode: z.literal('dom'),
    strategy: z.enum(['static', 'playwright']),
    navigate: z
      .array(
        z.object({
          action: z.enum(['goto', 'click', 'waitFor', 'scroll']),
          target: z.string().nullable(),
        }),
      )
      .max(4)
      .default([]),
    listSelector: z.string().min(1),
    fields: z.object({
      title: FieldSelectorSchema,
      url: FieldSelectorSchema,
      location: FieldSelectorSchema.nullable(),
      department: FieldSelectorSchema.nullable(),
    }),
    pagination: z.object({
      type: z.enum([
        'none',
        'next-link',
        'url-param',
        'load-more-button',
        'infinite-scroll',
      ]),
      value: z.string().nullable(),
      maxPages: z.number().int().min(1).max(25),
    }),
    urlPrefix: z.string().nullable(),
  })
  .merge(PlanMetadataSchema);

export const ScraperPlanSchema = z.discriminatedUnion('mode', [ApiPlanSchema, DomPlanSchema]);

export type ApiPlan = z.infer<typeof ApiPlanSchema>;
export type DomPlan = z.infer<typeof DomPlanSchema>;
export type ScraperPlan = z.infer<typeof ScraperPlanSchema>;
