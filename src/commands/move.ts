/** Registers manual status transitions through the single transition chokepoint. */
import type { Command } from 'commander';

import type { AppStatus } from '../db/index.js';
import { ApplicationService } from '../services/application.js';
import { ValidationError } from '../util/errors.js';
import type { CommandContext } from './types.js';

const VALID_STATUSES: readonly AppStatus[] = [
  'saved',
  'applied',
  'oa',
  'interview',
  'offer',
  'rejected',
];

/** Adds the `move` command to the root program. */
export function register(program: Command, context: CommandContext): void {
  program
    .command('move <id> <status>')
    .description(`manually transition an application's status (${VALID_STATUSES.join('|')})`)
    .action(async (idRaw: string, statusRaw: string) => moveApplication(context, idRaw, statusRaw));
}

async function moveApplication(
  context: CommandContext,
  idRaw: string,
  statusRaw: string,
): Promise<void> {
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id)) {
    throw new ValidationError(`Invalid application id: ${idRaw}.`);
  }
  if (!isAppStatus(statusRaw)) {
    throw new ValidationError(
      `Invalid status "${statusRaw}". Valid values: ${VALID_STATUSES.join(', ')}.`,
    );
  }

  const service = new ApplicationService(context.repos);
  const result = await service.transition(id, statusRaw);

  context.ui.success(`Application ${id} moved to ${statusRaw}.`);
  if (result.warning) {
    context.ui.warn(result.warning);
  }
}

function isAppStatus(value: string): value is AppStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}
