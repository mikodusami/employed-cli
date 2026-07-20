/**
 * Two-tier company (and best-effort role) extractor for application-status emails.
 *
 * @remarks No prototype was available to port verbatim for this unit (see decisions.md). The three
 * named example cases from the layer spec (Red Hat and Federal Reserve Bank of Atlanta via a
 * Workday sender local part, Whatnot via an Ashby subject line) are reproduced here as invented,
 * clearly-labeled illustrative fixtures — not literal real-inbox data — pending the owner's
 * real mappings. Independent of `classify`: extraction never looks at classification, vice versa.
 */
import type { EmailMeta } from './types.js';

interface ParsedSender {
  localPart: string;
  domain: string;
}

/**
 * Tier 2: ATS platforms (Workday chief among them) whose sending domain never carries the real
 * company — only a per-tenant local part does, which is opaque without a lookup table.
 */
const SENDER_LOCAL_PART_COMPANY_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'myworkday.com': {
    redhat: 'Red Hat',
    rb: 'Federal Reserve Bank of Atlanta',
  },
};

/**
 * Tier 1: subject-pattern extraction. Most ATS platforms (Ashby among them) send from a generic
 * `no-reply@` address but write the real company directly into the subject line, so a handful of
 * common phrasings cover the majority of cases without any per-domain table.
 */
const SUBJECT_COMPANY_PATTERNS: readonly RegExp[] = [
  /thank you for applying to ([^!.,\n]+)/i,
  /thanks for applying to ([^!.,\n]+)/i,
  /your application to ([^!.,\n]+)/i,
  /your application (?:at|for) ([^!.,\n]+)/i,
  /application (?:received|update) (?:for|at) ([^!.,\n]+)/i,
];

const ROLE_PATTERNS: readonly RegExp[] = [
  /for the ([^!.,\n]+?) (?:position|role)\b/i,
  /application for (?:the )?([^!.,\n]+?)(?: position| role)? at\b/i,
];

/** Extracts the hiring company from an email, or null when no rule identifies one. */
export function extractCompany(email: EmailMeta): string | null {
  const bySubject = extractFromSubject(email.subject);
  if (bySubject) {
    return bySubject;
  }

  const sender = parseSender(email.sender);
  if (!sender) {
    return null;
  }
  const domainMap = SENDER_LOCAL_PART_COMPANY_MAP[sender.domain];
  return domainMap?.[sender.localPart] ?? null;
}

/** Extracts a best-effort role/title from the subject line, or null when none is recognizable. */
export function extractRole(email: EmailMeta): string | null {
  for (const pattern of ROLE_PATTERNS) {
    const match = pattern.exec(email.subject);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function extractFromSubject(subject: string): string | null {
  for (const pattern of SUBJECT_COMPANY_PATTERNS) {
    const match = pattern.exec(subject);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

/** Parses `"Name <addr@domain>"` or a bare `addr@domain` sender string. */
function parseSender(sender: string): ParsedSender | null {
  const bracketed = /<([^<>@\s]+)@([^<>@\s]+)>/.exec(sender);
  const bare = bracketed ? null : /^([^<>@\s]+)@([^<>@\s]+)$/.exec(sender.trim());
  const match = bracketed ?? bare;
  if (!match) {
    return null;
  }
  return { localPart: match[1]?.toLowerCase() ?? '', domain: match[2]?.toLowerCase() ?? '' };
}
