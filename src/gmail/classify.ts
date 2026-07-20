/**
 * Ordered rule classifier for application-status emails.
 *
 * @remarks No prototype was available to port verbatim for this unit (see decisions.md); these
 * rules are original but structurally faithful to the layer spec's ordered pipeline. Treat them as
 * data — the ordering below is load-bearing, not incidental, and each stage's placement is
 * commented with why it must run where it does.
 */
import type { Classification, EmailClass, EmailMeta } from './types.js';

interface RuleContext {
  subject: string;
  snippet: string;
  sender: string;
}

interface ClassificationRule {
  type: EmailClass;
  patterns: readonly RegExp[];
  /** Matched against the sender address alone; only `ignore` currently needs this. */
  senderPatterns?: readonly RegExp[];
}

/**
 * Order matters and must not be reshuffled without re-running the full fixture suite:
 *
 * 1. `ignore` runs first so job-alert digests and newsletters never fall through to a false
 *    positive on a later stage — a digest that happens to mention "interview" must still be
 *    ignored, not misclassified as an interview invite.
 * 2. `rejected` runs immediately after, and critically *before* `applied`, because a rejection's
 *    opening line is almost always "thank you for your interest/applying" — the exact phrase an
 *    application-confirmation email also uses. Checking `applied` first would misclassify nearly
 *    every rejection as a confirmation. This ordering is the single most important correctness
 *    detail in this module.
 * 3. `offer`, `oa`, and `interview` follow in roughly the order a candidate encounters them in a
 *    real pipeline; none of their patterns overlap with each other in practice.
 * 4. `applied` runs last among the matching rules so its broad "thank you for your interest"
 *    pattern only fires once every more specific, higher-priority state has had a chance to match.
 */
const RULES: readonly ClassificationRule[] = [
  {
    type: 'ignore',
    patterns: [
      /\bjob alert(s)?\b/,
      /\bnew jobs? (matching|for you)\b/,
      /\bjobs? recommended for you\b/,
      /\bweekly (job )?digest\b/,
      /\bwe'?d love your feedback\b/,
      /\btake (our|this) (survey|quick survey)\b/,
      /\bnewsletter\b/,
    ],
    // Known job-alert/digest senders are ignored on sender identity alone, since their subject
    // lines are written to look exactly like a real update ("5 new interviews matching your
    // search") specifically to get opened.
    senderPatterns: [/jobalerts-noreply@/, /@jobs-noreply\./, /digest@/],
  },
  {
    type: 'rejected',
    patterns: [
      /\bmove(d|ing)? forward with other candidates\b/,
      /\bdecided not to move forward\b/,
      /\bwill not be moving forward\b/,
      /\bpursu(e|ing) other candidates\b/,
      /\b(has|have) not been selected\b/,
      /\bunable to offer you\b/,
      /\bposition has (already )?been filled\b/,
      /\bwe will not be proceeding\b/,
    ],
  },
  {
    type: 'offer',
    patterns: [
      /\bpleased to (offer|extend( you| an offer))\b/,
      /\bjob offer\b/,
      /\boffer letter\b/,
      /\bexcited to offer you\b/,
      /\bwe(’|')?d like to offer you\b/,
    ],
  },
  {
    type: 'oa',
    patterns: [
      /\bonline assessment\b/,
      /\bcoding (challenge|test|assessment)\b/,
      /\bhackerrank\b/,
      /\bcodesignal\b/,
      /\btechnical assessment\b/,
      /\btake-home (project|assignment|assessment)\b/,
    ],
  },
  {
    type: 'interview',
    patterns: [
      /\bschedule (an |your )?interview\b/,
      /\binterview invitation\b/,
      /\bphone screen\b/,
      /\bwould like to (invite you to |schedule an )?interview\b/,
      /\bchat with (our|the) recruiter\b/,
      /\brecruiter call\b/,
    ],
  },
  {
    type: 'applied',
    patterns: [
      /\bthank you for (your interest|applying)\b/,
      /\bapplication (has been )?received\b/,
      /\bwe(’|')?ve received your application\b/,
      /\byour application (to|for|at)\b/,
    ],
  },
];

/** Classifies one email against the ordered rule table; the first matching rule wins. */
export function classify(email: EmailMeta): Classification {
  const context: RuleContext = {
    subject: email.subject.toLowerCase(),
    snippet: email.snippet.toLowerCase(),
    sender: email.sender.toLowerCase(),
  };
  const combinedText = `${context.subject} ${context.snippet}`;

  for (const rule of RULES) {
    const textMatch = rule.patterns.some((pattern) => pattern.test(combinedText));
    const senderMatch = rule.senderPatterns?.some((pattern) => pattern.test(context.sender));
    if (textMatch || senderMatch) {
      return { type: rule.type, company: null, role: null, confidence: 'high' };
    }
  }

  return { type: null, company: null, role: null, confidence: 'low' };
}
