/** Registers interactive Gmail sync: fetch, classify, propose, and apply CRM updates. */
import { isCancel, multiselect } from '@clack/prompts';
import type { Command } from 'commander';

import { AiTailClassifier } from '../gmail/ai-classify.js';
import { EmailFetcher } from '../gmail/fetch.js';
import { ApplicationService } from '../services/application.js';
import { SyncService, type ProposalPrompter, type SyncProposal } from '../services/sync.js';
import type { CommandContext } from './types.js';

interface SyncCommandOptions {
  days: string;
}

/** Adds the `sync` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('sync')
    .description('sync Gmail application-status emails into the CRM (interactive)')
    .option('--days <n>', 'how many days back to search Gmail', '30')
    .action(async (options: SyncCommandOptions) => runSync(context, options));
}

async function runSync(context: CommandContext, options: SyncCommandOptions): Promise<void> {
  if (!context.ai) {
    context.ui.info(
      'Gmail sync needs an AI provider with Gmail MCP configured — see `employed doctor`.',
    );
    return;
  }

  const days = Number.parseInt(options.days, 10);
  const service = new SyncService(
    context.repos,
    new ApplicationService(context.repos),
    new EmailFetcher(context.ai),
    new AiTailClassifier(context.ai),
    context.ai,
    new ClackProposalPrompter(),
  );

  context.ui.info(`Fetching the last ${days} day(s) of Gmail threads…`);
  const result = await service.run('interactive', { days });

  context.ui.success(
    `Fetched ${result.fetched} thread(s), ${result.newlyProcessed} new since the last sync.`,
  );
  context.ui.table(
    ['Metric', 'Value'],
    [
      ['Applied', String(result.applied)],
      ['Deferred', String(result.deferred)],
      ['Ignored', String(result.ignored)],
      ['Unresolved', String(result.unresolved)],
    ],
  );
}

/** Wraps `@clack/prompts`' multi-select so `SyncService` itself never depends on a UI library. */
class ClackProposalPrompter implements ProposalPrompter {
  public async selectProposals(proposals: readonly SyncProposal[]): Promise<readonly string[]> {
    if (proposals.length === 0) {
      return [];
    }
    const selected = await multiselect({
      message: 'Select proposals to apply (space to toggle, enter to confirm)',
      options: proposals.map((proposal) => ({
        value: proposal.threadId,
        label: describeProposal(proposal),
      })),
      required: false,
    });
    return isCancel(selected) ? [] : selected;
  }
}

function describeProposal(proposal: SyncProposal): string {
  const role = proposal.role ? ` (${proposal.role})` : '';
  const action = proposal.action === 'create' ? 'new application' : 'update existing';
  return `${proposal.company}${role} — ${proposal.type}, ${action}`;
}
