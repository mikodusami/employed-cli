/** Registers appending a free-text note to an application without changing its status. */
import type { Command } from 'commander';

import { ApplicationService } from '../services/application.js';
import { ValidationError } from '../util/errors.js';
import type { CommandContext } from './types.js';

/** Adds the `note` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('note <id> <text>')
    .description('append a note to an application (does not change its status)')
    .action(async (idRaw: string, text: string) => addNote(context, idRaw, text));
}

async function addNote(context: CommandContext, idRaw: string, text: string): Promise<void> {
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id)) {
    throw new ValidationError(`Invalid application id: ${idRaw}.`);
  }

  const service = new ApplicationService(context.repos);
  await service.addNote(id, text);
  context.ui.success(`Note added to application ${id}.`);
}
