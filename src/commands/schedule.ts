/** Registers the OS scheduler installer: `employed schedule install|remove|status`. */
import type { Command } from 'commander';

import { ScheduleService } from '../services/schedule.js';
import type { CommandContext } from './types.js';

interface InstallOptions {
  at?: string;
  force?: boolean;
}

/** Adds the `schedule` command group to the root program. */
export function register(program: Command, context: CommandContext): void {
  const schedule = program.command('schedule').description('manage the daily OS scheduler');

  schedule
    .command('install')
    .description('install a daily launchd (macOS) or cron (Linux) job that runs `employed run`')
    .option('--at <HH:MM>', 'time of day to run, defaults to config.run.time')
    .option('--force', 'overwrite an already-installed schedule')
    .action((options: InstallOptions) => install(context, options));

  schedule
    .command('remove')
    .description('remove the installed daily schedule')
    .action(() => remove(context));

  schedule
    .command('status')
    .description('show whether the daily schedule is installed and its next fire time')
    .action(() => status(context));
}

function install(context: CommandContext, options: InstallOptions): void {
  const at = options.at ?? context.config.loadApp().run.time;
  const service = new ScheduleService();
  const preview = service.buildArtifact(at);
  context.ui.heading(`Generated schedule artifact (${preview.path})`);
  context.ui.output(preview.content);

  const artifact = service.install(at, options.force ?? false);
  context.ui.success(`Schedule installed for ${at} daily at ${artifact.path}`);
}

function remove(context: CommandContext): void {
  const service = new ScheduleService();
  const removed = service.remove();
  if (removed) {
    context.ui.success('Schedule removed.');
  } else {
    context.ui.info('No schedule was installed.');
  }
}

function status(context: CommandContext): void {
  const service = new ScheduleService();
  const result = service.status();
  if (!result.installed) {
    context.ui.info('No schedule is installed.');
    return;
  }
  context.ui.table(
    ['Field', 'Value'],
    [
      ['Installed', 'yes'],
      ['Location', result.path],
      ['Time', result.time ?? 'unknown'],
      ['Next run', result.nextRun ?? 'unknown'],
    ],
  );
}
