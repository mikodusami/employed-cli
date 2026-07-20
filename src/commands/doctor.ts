/** Registers read-only environment diagnostics. */
import type { Command } from 'commander';

import { DB_PATH } from '../constants.js';
import { DoctorService } from '../services/doctor.js';
import type { CommandContext } from './types.js';

export function register(program: Command, context: CommandContext): void {
  program
    .command('doctor')
    .description('diagnose AI providers and database health')
    .action(async () => inspect(context));
}

async function inspect(context: CommandContext): Promise<void> {
  const result = await new DoctorService(context.db, context.config.loadApp(), DB_PATH).inspect();

  context.ui.heading('AI providers');
  if (result.aiDisabled) {
    context.ui.info('AI disabled by config');
  }
  context.ui.table(
    ['Provider', 'Enabled', 'Installed', 'Version / Detail', 'Active'],
    result.providers.map((provider) => [
      provider.name,
      provider.enabled ? 'yes' : 'no',
      provider.installed ? 'yes' : 'no',
      provider.version ?? provider.detail ?? 'unknown',
      provider.active ? '*' : '',
    ]),
  );

  context.ui.heading('Database');
  context.ui.table(
    ['Check', 'Value'],
    [
      ['Path', result.database.path],
      ['Schema version', String(result.database.version)],
      ['Table count', String(result.database.tableCount)],
      ['Integrity', result.database.integrity],
    ],
  );
}
