/** Registers the full-detail view of one application: header plus its event timeline. */
import type { Command } from 'commander';

import { ApplicationService } from '../services/application.js';
import { ValidationError } from '../util/errors.js';
import { relativeTime } from '../util/time.js';
import type { CommandContext } from './types.js';

/** Adds the `app` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('app <id>')
    .description('show one application in full detail, including its event timeline')
    .action((idRaw: string) => showApplication(context, idRaw));
}

function showApplication(context: CommandContext, idRaw: string): void {
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id)) {
    throw new ValidationError(`Invalid application id: ${idRaw}.`);
  }

  const service = new ApplicationService(context.repos);
  const { application, events } = service.detail(id);

  context.ui.heading(`${application.company_name} — ${application.role ?? 'Unknown role'}`);
  context.ui.table(
    ['Field', 'Value'],
    [
      ['Status', application.status],
      ['Résumé', application.resume_version ?? '—'],
      ['Applied', application.applied_at ? relativeTime(application.applied_at) : '—'],
      [
        'First response',
        application.first_response_at ? relativeTime(application.first_response_at) : '—',
      ],
      [
        'Last activity',
        application.last_activity_at ? relativeTime(application.last_activity_at) : '—',
      ],
      ['Notes', application.notes ?? '—'],
    ],
  );

  context.ui.heading('Event timeline');
  if (events.length === 0) {
    context.ui.info('No events recorded yet.');
    return;
  }
  context.ui.table(
    ['Date', 'Type', 'Note'],
    events.map((event) => [relativeTime(event.at), event.type, event.note ?? '—']),
  );
}
