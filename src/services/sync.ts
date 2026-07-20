/**
 * Six-stage Gmail sync pipeline: fetch, seen-filter, rule-classify, AI tail, resolve, apply.
 *
 * @remarks Rules first, AI second, always. The ledger makes this idempotent and re-runnable —
 * the same property `RunService` relies on for `run` itself. See decisions.md for the deliberate
 * scope boundary around "everything else defers to the next interactive sync": a deferred cron
 * proposal is still ledgered (so cron never re-fetches or re-classifies the same raw email every
 * morning) but is not automatically re-surfaced by a later interactive sync in this unit.
 */
import type { AutoAppliedUpdate } from '../report/model.js';
import { classify } from '../gmail/classify.js';
import { extractCompany, extractRole } from '../gmail/extract-company.js';
import type { AiClassificationResult } from '../gmail/ai-classify.js';
import type { EmailMeta, EmailClass } from '../gmail/types.js';
import type { AiRunner } from '../ai/types.js';
import type { AppStatus, Repositories } from '../db/index.js';
import type { ApplicationService } from './application.js';

export type SyncMode = 'interactive' | 'cron';

export interface SyncOptions {
  days: number;
}

/** One proposed CRM action, ready to apply or to present to the user for approval. */
export interface SyncProposal {
  threadId: string;
  action: 'create' | 'update';
  type: EmailClass;
  company: string;
  role: string | null;
  applicationId: number | null;
  /** The rule classifier's confidence; `low` means this proposal's type came from the AI tail. */
  confidence: 'high' | 'low';
}

export interface SyncResult {
  mode: SyncMode;
  skipped: boolean;
  fetched: number;
  newlyProcessed: number;
  applied: number;
  deferred: number;
  ignored: number;
  unresolved: number;
  autoApplied: readonly AutoAppliedUpdate[];
}

/** Presents proposals for approval; the real CLI implementation wraps `@clack/prompts`. */
export interface ProposalPrompter {
  /** Returns the thread IDs of the accepted proposals. */
  selectProposals(proposals: readonly SyncProposal[]): Promise<readonly string[]>;
}

export interface EmailFetcherLike {
  fetch(days: number): Promise<EmailMeta[]>;
}

export interface AiTailClassifierLike {
  classify(lowConfidence: readonly EmailMeta[]): Promise<readonly AiClassificationResult[]>;
}

const TYPE_TO_STATUS: Readonly<Record<EmailClass, AppStatus | null>> = {
  applied: 'applied',
  oa: 'oa',
  interview: 'interview',
  offer: 'offer',
  rejected: 'rejected',
  ignore: null,
};

/** Counts already known before the apply stage, carried through so it need not be recomputed. */
interface SyncTally {
  mode: SyncMode;
  fetched: number;
  newlyProcessed: number;
  ignored: number;
  unresolved: number;
  nowIso: string;
}

function skippedResult(mode: SyncMode): SyncResult {
  return {
    mode,
    skipped: true,
    fetched: 0,
    newlyProcessed: 0,
    applied: 0,
    deferred: 0,
    ignored: 0,
    unresolved: 0,
    autoApplied: [],
  };
}

export class SyncService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly applications: ApplicationService,
    private readonly fetcher: EmailFetcherLike,
    private readonly tailClassifier: AiTailClassifierLike,
    private readonly ai: AiRunner | null,
    private readonly prompter: ProposalPrompter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async run(mode: SyncMode, options: SyncOptions): Promise<SyncResult> {
    if (!this.ai) {
      return skippedResult(mode);
    }

    const allEmails = await this.fetcher.fetch(options.days);
    const unseen = this.filterUnseen(allEmails);
    const ruleResults = new Map(unseen.map((email) => [email.threadId, classify(email)]));
    const lowConfidenceEmails = unseen.filter(
      (email) => ruleResults.get(email.threadId)?.confidence === 'low',
    );
    const aiResults = await this.tailClassifier.classify(lowConfidenceEmails);
    const aiByThread = new Map(aiResults.map((result) => [result.id, result]));

    const nowIso = this.now().toISOString();
    let ignored = 0;
    let unresolved = 0;
    const proposals: SyncProposal[] = [];

    for (const email of unseen) {
      const outcome = this.resolveEmail(email, ruleResults, aiByThread);
      if (outcome.kind === 'ignored') {
        ignored += 1;
        this.repositories.emailThreads.markProcessed({
          thread_id: email.threadId,
          classified_as: 'ignore',
          processed_at: nowIso,
        });
      } else if (outcome.kind === 'unresolved') {
        unresolved += 1;
        this.repositories.emailThreads.markProcessed({
          thread_id: email.threadId,
          classified_as: outcome.type,
          processed_at: nowIso,
        });
      } else {
        proposals.push(outcome.proposal);
      }
    }

    const tally: SyncTally = {
      mode,
      fetched: allEmails.length,
      newlyProcessed: unseen.length,
      ignored,
      unresolved,
      nowIso,
    };
    return mode === 'cron'
      ? this.applyCron(tally, proposals)
      : this.applyInteractive(tally, proposals);
  }

  private filterUnseen(emails: readonly EmailMeta[]): EmailMeta[] {
    const threadIds = emails.map((email) => email.threadId);
    const seen = this.repositories.emailThreads.seenThreadIds(threadIds);
    return emails.filter((email) => !seen.has(email.threadId));
  }

  private resolveEmail(
    email: EmailMeta,
    ruleResults: ReadonlyMap<string, ReturnType<typeof classify>>,
    aiByThread: ReadonlyMap<string, AiClassificationResult>,
  ):
    | { kind: 'ignored' }
    | { kind: 'unresolved'; type: EmailClass | null }
    | { kind: 'proposal'; proposal: SyncProposal } {
    const rule = ruleResults.get(email.threadId);
    const isHigh = rule?.confidence === 'high';
    const aiResult = aiByThread.get(email.threadId);
    const resolvedType: EmailClass | null = isHigh
      ? (rule?.type ?? null)
      : (aiResult?.type ?? null);

    if (resolvedType === null) {
      return { kind: 'unresolved', type: null };
    }
    if (resolvedType === 'ignore') {
      return { kind: 'ignored' };
    }

    const company = extractCompany(email) ?? aiResult?.company ?? null;
    const role = extractRole(email) ?? aiResult?.role ?? null;
    if (!company) {
      return { kind: 'unresolved', type: resolvedType };
    }

    const existing = this.repositories.applications.findByCompanyRole(company, role);
    return {
      kind: 'proposal',
      proposal: {
        threadId: email.threadId,
        action: existing ? 'update' : 'create',
        type: resolvedType,
        company,
        role,
        applicationId: existing?.id ?? null,
        confidence: isHigh ? 'high' : 'low',
      },
    };
  }

  /** Auto-applies only high-confidence, exact-match status updates; everything else defers. */
  private async applyCron(
    tally: SyncTally,
    proposals: readonly SyncProposal[],
  ): Promise<SyncResult> {
    let applied = 0;
    let deferred = 0;
    const autoApplied: AutoAppliedUpdate[] = [];

    for (const proposal of proposals) {
      const shouldAutoApply = proposal.confidence === 'high' && proposal.action === 'update';
      if (!shouldAutoApply) {
        deferred += 1;
        // Deferred, but still ledgered (application_id null) so cron never re-fetches or
        // re-classifies the same raw email every morning; see decisions.md for the scope boundary
        // around not automatically re-surfacing these in a later interactive sync.
        this.repositories.emailThreads.markProcessed({
          thread_id: proposal.threadId,
          classified_as: proposal.type,
          processed_at: tally.nowIso,
        });
        continue;
      }
      await this.applyProposal(proposal);
      applied += 1;
      autoApplied.push({
        company: proposal.company,
        role: proposal.role ?? 'Unknown role',
        status: TYPE_TO_STATUS[proposal.type] ?? proposal.type,
      });
      this.repositories.emailThreads.markProcessed({
        thread_id: proposal.threadId,
        application_id: proposal.applicationId,
        classified_as: proposal.type,
        processed_at: tally.nowIso,
      });
    }

    return { ...tally, skipped: false, applied, deferred, autoApplied };
  }

  /** Both accepted and rejected proposals are ledgered so neither re-surfaces every sync. */
  private async applyInteractive(
    tally: SyncTally,
    proposals: readonly SyncProposal[],
  ): Promise<SyncResult> {
    const acceptedIds = new Set(await this.prompter.selectProposals(proposals));
    let applied = 0;
    let deferred = 0;

    for (const proposal of proposals) {
      const accepted = acceptedIds.has(proposal.threadId);
      if (accepted) {
        await this.applyProposal(proposal);
        applied += 1;
      } else {
        deferred += 1;
      }
      this.repositories.emailThreads.markProcessed({
        thread_id: proposal.threadId,
        application_id: accepted ? proposal.applicationId : null,
        classified_as: proposal.type,
        processed_at: tally.nowIso,
      });
    }

    return { ...tally, skipped: false, applied, deferred, autoApplied: [] };
  }

  /**
   * Routes every CRM write through `ApplicationService` (never a direct repository write) so a
   * sync-driven status change produces the identical event shape as a manual `move` — see
   * decisions.md for why this superseded Unit 2's original `type: 'email'` tagging.
   */
  private async applyProposal(proposal: SyncProposal): Promise<void> {
    const status = TYPE_TO_STATUS[proposal.type];
    if (!status) {
      return;
    }
    const note = `Classified as ${proposal.type} via email sync (thread ${proposal.threadId}).`;
    if (proposal.action === 'create') {
      await this.applications.createManual({
        company: proposal.company,
        role: proposal.role,
        status,
        note,
      });
      return;
    }
    if (proposal.applicationId !== null) {
      await this.applications.transition(proposal.applicationId, status, { note });
    }
  }
}
