/** Durable failure evidence for scraper plans that require manual review. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { EMPLOYED_DIR } from '../constants.js';
import type { AnalysisPacket } from './analyze.js';
import type { CaptureResult } from './capture/index.js';
import type { ScraperPlan } from './plan.js';

export interface AttemptDiagnostic {
  attempt: number;
  plan: ScraperPlan | null;
  errors: readonly string[];
}

export function writeDiagnosticsBundle(
  companyName: string,
  capture: CaptureResult | null,
  analysis: AnalysisPacket | null,
  attempts: readonly AttemptDiagnostic[],
  baseDirectory = EMPLOYED_DIR,
  now: Date = new Date(),
): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const directory = path.join(
    baseDirectory,
    'debug',
    `${safeName(companyName)}-${stamp}`,
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'captured.html'), capture?.html ?? '', 'utf8');
  writeFileSync(
    path.join(directory, 'network.txt'),
    analysis?.networkSummary ?? 'No network evidence captured.',
    'utf8',
  );
  writeFileSync(
    path.join(directory, 'attempts.json'),
    `${JSON.stringify(attempts, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(directory, 'navigation.json'),
    `${JSON.stringify(capture?.navigationPath ?? [], null, 2)}\n`,
    'utf8',
  );
  return directory;
}

function safeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'company';
}
