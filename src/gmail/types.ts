/** Email domain shapes shared by the classifier, extractor, and Gmail fetch/sync layer. */
import { z } from 'zod';

/** What the fetch layer produces; also the runtime validation schema for its AI response. */
export const EmailMetaSchema = z.object({
  threadId: z.string(),
  date: z.string(),
  sender: z.string(),
  subject: z.string(),
  snippet: z.string(),
});

/** One fetched email's metadata, validated against `EmailMetaSchema` when it comes from AI. */
export type EmailMeta = z.infer<typeof EmailMetaSchema>;

/** The outcome categories a rule can confidently assign. */
export type EmailClass = 'applied' | 'oa' | 'interview' | 'offer' | 'rejected' | 'ignore';

/**
 * Result of classifying one email.
 *
 * @remarks `type` is null only when no rule matched: a fall-through is a distinct, low-confidence
 * signal for the AI fallback (a later unit), not the same thing as a deliberately-`ignore`d email.
 */
export interface Classification {
  type: EmailClass | null;
  company: string | null;
  role: string | null;
  confidence: 'high' | 'low';
}
