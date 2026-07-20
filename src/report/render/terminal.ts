/** Terminal renderer over the same model used by Markdown and JSON. */
import type { Band } from '../../db/types.js';
import type { UI } from '../../ui/index.js';
import type { DailyReport } from '../model.js';

const BANDS: readonly Band[] = ['A', 'B', 'C', 'D'];

export function renderTerminal(report: DailyReport, ui: UI): void {
  ui.heading(`New jobs — ${report.date}`);
  if (report.summary) {
    ui.info(report.summary);
  }
  if (report.runStats) {
    const stats = report.runStats;
    ui.info(
      `${stats.companiesScanned} companies · ${stats.jobsSeen} seen · ${stats.jobsNew} new · ` +
        `${stats.failures} failures · ${stats.healed} healed · ${stats.broken} broken`,
    );
  } else {
    ui.info('Manual report — no run statistics recorded.');
  }

  let hasJobs = false;
  for (const band of BANDS) {
    const jobs = report.newJobsByBand[band];
    if (jobs.length === 0) {
      continue;
    }
    hasJobs = true;
    ui.heading(`Band ${band}`);
    ui.table(
      ['Score', 'Band', 'Company', 'Title', 'Location', 'Age'],
      jobs.map((job) => [
        String(job.score),
        job.band,
        job.company,
        job.titleOnly ? `${job.title} [title-only]` : job.title,
        job.location ?? '—',
        job.ageDays === 0 ? 'today' : `${job.ageDays}d`,
      ]),
    );
  }
  if (!hasJobs) {
    ui.info('No new jobs.');
  }

  if (report.autoApplied.length > 0) {
    ui.heading('Auto-applied');
    ui.table(
      ['Company', 'Role', 'Status'],
      report.autoApplied.map((update) => [update.company, update.role, update.status]),
    );
  }
  if (report.needsAttention.length > 0) {
    ui.heading('Needs attention');
    for (const item of report.needsAttention) {
      ui.warn(item.message);
    }
  }
}
