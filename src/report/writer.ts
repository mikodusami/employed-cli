/** Idempotent filesystem export for one dated Markdown projection. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { REPORTS_DIR } from '../constants.js';
import type { DailyReport } from './model.js';
import { renderMarkdown } from './render/markdown.js';

export function writeReport(report: DailyReport, reportsDirectory = REPORTS_DIR): string {
  mkdirSync(reportsDirectory, { recursive: true });
  const reportPath = path.join(reportsDirectory, `${report.date}.md`);
  writeFileSync(reportPath, renderMarkdown(report), 'utf8');
  return reportPath;
}
