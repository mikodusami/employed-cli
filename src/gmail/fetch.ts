/**
 * Retrieves candidate application-status emails via the AI CLI's own Gmail MCP connection.
 *
 * @remarks `employed` never touches Google credentials directly — the AI CLI (Claude Code or
 * Codex) does the retrieval through its own configured Gmail MCP tool, which is the entire reason
 * this delegation architecture exists (see decisions.md). The search query below is original,
 * not ported from any prototype (none exists — see decisions.md).
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { renderTemplate } from '../ai/templates.js';
import type { AiRunner } from '../ai/types.js';
import { EmailMetaSchema, type EmailMeta } from './types.js';

const TEMPLATE_ID = 'email_fetch_v1';
const FETCH_TIMEOUT_MS = 120_000;
const MAX_THREADS = 250;
const EmailMetaArraySchema = z.array(EmailMetaSchema);

/** Sender/subject signals for common ATS platforms, plus generic application-status subjects. */
const GMAIL_QUERY_TERMS =
  '(from:greenhouse.io OR from:lever.co OR from:ashbyhq.com OR from:myworkday.com OR ' +
  'from:smartrecruiters.com OR from:icims.com OR from:workable.com OR ' +
  'subject:(application OR interview OR assessment OR offer))';

/** Builds the Gmail search query for one fetch window. */
export function buildGmailQuery(days: number): string {
  return `newer_than:${days}d ${GMAIL_QUERY_TERMS}`;
}

/** Fetches up to `MAX_THREADS` candidate emails through the AI CLI's Gmail MCP tool. */
export class EmailFetcher {
  public constructor(private readonly ai: AiRunner) {}

  public async fetch(days: number): Promise<EmailMeta[]> {
    const query = buildGmailQuery(days);
    return this.ai.runJson({
      templateId: TEMPLATE_ID,
      input: renderTemplate(TEMPLATE_ID, {
        days: String(days),
        query,
        max_threads: String(MAX_THREADS),
        schema: JSON.stringify(z.toJSONSchema(EmailMetaArraySchema), null, 2),
      }),
      // Retrieval is inherently always-fresh: the same query digest today and tomorrow should
      // still hit Gmail rather than replay a stale cached inbox snapshot.
      inputDigest: digest(`${days}:${query}`),
      schema: EmailMetaArraySchema,
      timeoutMs: FETCH_TIMEOUT_MS,
      allowedTools: ['mcp__gmail__search_threads'],
      noCache: true,
    });
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
