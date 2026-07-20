/** Pure Markdown renderer for the serializable daily-report model. */
import type { Band } from '../../db/types.js';
import type { DailyReport, ReportJob } from '../model.js';

const BANDS: readonly Band[] = ['A', 'B', 'C', 'D'];

export function renderMarkdown(report: DailyReport): string {
  const lines = [`# Employed Daily Report — ${report.date}`, ''];
  if (report.summary) {
    lines.push(report.summary, '');
  }

  lines.push('## Run', '');
  if (report.runStats) {
    const stats = report.runStats;
    lines.push(
      `${stats.companiesScanned} companies scanned · ${stats.jobsSeen} jobs seen · ` +
        `${stats.jobsNew} new · ${stats.failures} failures · ${stats.healed} healed · ` +
        `${stats.broken} broken`,
      '',
    );
  } else {
    lines.push('Manual report — no run statistics recorded.', '');
  }

  lines.push('## New Jobs', '');
  let jobCount = 0;
  for (const band of BANDS) {
    const jobs = report.newJobsByBand[band];
    if (jobs.length === 0) {
      continue;
    }
    jobCount += jobs.length;
    lines.push(`### Band ${band}`, '');
    for (const job of jobs) {
      lines.push(renderJob(job));
    }
    lines.push('');
  }
  if (jobCount === 0) {
    lines.push('No new jobs.', '');
  }

  if (report.autoApplied.length > 0) {
    lines.push('## Auto-applied', '');
    for (const update of report.autoApplied) {
      const company = escapeText(update.company);
      const role = escapeText(update.role);
      lines.push(`- **${company}** — ${role}: ${update.status}`);
    }
    lines.push('');
  }

  if (report.needsAttention.length > 0) {
    lines.push('## Needs Attention', '');
    for (const item of report.needsAttention) {
      lines.push(`- **${escapeText(item.company)}** — ${escapeText(item.message)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderJob(job: ReportJob): string {
  const location = job.location ? escapeText(job.location) : 'Location unavailable';
  const marker = job.titleOnly ? ' · `title-only`' : '';
  return (
    `- **${job.score}** · **${escapeText(job.company)}** · ` +
    `[${escapeText(job.title)}](${job.url}) · ${location} · ${formatAge(job.ageDays)}${marker}`
  );
}

function formatAge(ageDays: number): string {
  if (ageDays === 0) {
    return 'today';
  }
  return `${ageDays} day${ageDays === 1 ? '' : 's'} old`;
}

function escapeText(value: string): string {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}
