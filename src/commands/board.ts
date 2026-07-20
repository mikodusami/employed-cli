/** Registers the pipeline board: applications grouped by status. */
import type { Command } from 'commander';

import type { AppStatus, ApplicationRow } from '../db/index.js';
import { ApplicationService } from '../services/application.js';
import { relativeTime } from '../util/time.js';
import type { CommandContext } from './types.js';

interface BoardOptions {
  all?: boolean;
}

const COLUMNS: readonly { status: AppStatus; label: string }[] = [
  { status: 'applied', label: 'Applied' },
  { status: 'oa', label: 'OA' },
  { status: 'interview', label: 'Interview' },
  { status: 'offer', label: 'Offer' },
  { status: 'rejected', label: 'Rejected' },
];

/** Adds the `board` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('board')
    .description('view the application pipeline as a board')
    .option('--all', 'show every rejected application instead of a collapsed summary')
    .action((options: BoardOptions) => showBoard(context, options));
}

function showBoard(context: CommandContext, options: BoardOptions): void {
  const service = new ApplicationService(context.repos);
  const applications = service.list();

  if (applications.length === 0) {
    context.ui.info(
      'No applications yet. Run `employed apply <jobId>` after `employed new`, ' +
        'or `employed sync` to import from email.',
    );
    return;
  }

  for (const column of COLUMNS) {
    const rows = applications.filter((application) => application.status === column.status);
    context.ui.heading(`${column.label} (${rows.length})`);
    if (rows.length === 0) {
      continue;
    }
    if (column.status === 'rejected' && !options.all) {
      context.ui.info(`${rows.length} rejected — pass --all to show them.`);
      continue;
    }
    context.ui.table(
      ['Company', 'Role', 'Age', 'Résumé'],
      rows.map((application) => formatRow(application)),
    );
  }
}

function formatRow(application: ApplicationRow): string[] {
  // Freshly created applications have no last_activity_at yet (set on their first transition);
  // created_at is the closest honest fallback rather than showing a placeholder like "never".
  const age = application.last_activity_at ?? application.created_at;
  return [
    application.company_name,
    application.role ?? 'Unknown role',
    relativeTime(age),
    application.resume_version ?? '—',
  ];
}
