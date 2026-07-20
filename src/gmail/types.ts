/** Email domain shapes shared by the classifier, extractor, and future Gmail fetch layer. */

/** What the fetch layer (a later unit) will provide; defined first so this unit can be built and
 * tested against the contract before anything produces a real value. */
export interface EmailMeta {
  threadId: string;
  date: string;
  sender: string;
  subject: string;
  snippet: string;
}

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
