/** Registers portable JSON and CSV data exports. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { ExportService, type ExportKind } from '../services/export.js';
import { ValidationError } from '../util/errors.js';
import type { CommandContext } from './types.js';

interface ExportOptions {
  csv?: boolean;
  json?: boolean;
  kind?: string;
  out?: string;
}

export function register(program: Command, context: CommandContext): void {
  program
    .command('export')
    .description('export a versioned JSON snapshot or spreadsheet-friendly CSV')
    .option('--json', 'export JSON (the default)')
    .option('--csv', 'export CSV')
    .option('--kind <kind>', 'CSV dataset: applications or jobs', 'applications')
    .option('--out <file>', 'write to a file instead of stdout')
    .action((options: ExportOptions) => exportData(context, options));
}

function exportData(context: CommandContext, options: ExportOptions): void {
  if (options.csv && options.json) {
    throw new ValidationError('Choose either --csv or --json, not both.');
  }
  const kind = parseKind(options.kind ?? 'applications');
  const service = new ExportService(context.repos);
  const output = options.csv
    ? service.exportCsv(kind)
    : `${JSON.stringify(service.exportJson(), null, 2)}\n`;
  if (!options.out) {
    context.ui.output(output.trimEnd());
    return;
  }
  const outputPath = path.resolve(options.out);
  writeFileSync(outputPath, output, 'utf8');
  context.ui.success(`Exported ${options.csv ? `${kind} CSV` : 'JSON'} to ${outputPath}`);
}

function parseKind(value: string): ExportKind {
  if (value === 'applications' || value === 'jobs') {
    return value;
  }
  throw new ValidationError('Invalid export kind. Use applications or jobs.');
}
