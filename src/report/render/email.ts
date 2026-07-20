/** Pure, email-client-safe renderers over the existing daily report model. */
import type { Band } from '../../db/types.js';
import type { DailyReport, ReportJob } from '../model.js';

const BANDS: readonly Band[] = ['A', 'B', 'C', 'D'];

export function renderEmailHtml(report: DailyReport): string {
  const sections = [
    '<!doctype html>',
    '<html><body style="font-family:Arial,sans-serif;color:#202124;line-height:1.45">',
    `<h1 style="font-size:22px">employed daily report — ${escapeHtml(report.date)}</h1>`,
  ];
  if (report.summary) {
    sections.push(`<p>${escapeHtml(report.summary)}</p>`);
  }
  sections.push(renderRunHtml(report), renderJobsHtml(report));
  if (report.autoApplied.length > 0) {
    sections.push('<h2 style="font-size:18px">Auto-applied</h2><ul>');
    for (const update of report.autoApplied) {
      sections.push(
        `<li><strong>${escapeHtml(update.company)}</strong> — ${escapeHtml(update.role)}: ` +
          `${escapeHtml(update.status)}</li>`,
      );
    }
    sections.push('</ul>');
  }
  if (report.needsAttention.length > 0) {
    sections.push('<h2 style="font-size:18px;color:#b3261e">Needs attention</h2><ul>');
    for (const item of report.needsAttention) {
      sections.push(
        `<li><strong>${escapeHtml(item.company)}</strong> — ${escapeHtml(item.message)}</li>`,
      );
    }
    sections.push('</ul>');
  }
  sections.push('</body></html>');
  return sections.join('\n');
}

export function renderEmailText(report: DailyReport): string {
  const lines = [`employed daily report — ${report.date}`, ''];
  if (report.summary) {
    lines.push(report.summary, '');
  }
  lines.push(renderRunText(report), '', 'New jobs');
  let jobCount = 0;
  for (const band of BANDS) {
    const jobs = report.newJobsByBand[band];
    if (jobs.length === 0) {
      continue;
    }
    jobCount += jobs.length;
    lines.push('', `Band ${band}`);
    for (const job of jobs) {
      lines.push(renderJobText(job));
    }
  }
  if (jobCount === 0) {
    lines.push('No new jobs.');
  }
  if (report.autoApplied.length > 0) {
    lines.push('', 'Auto-applied');
    for (const update of report.autoApplied) {
      lines.push(`- ${update.company} — ${update.role}: ${update.status}`);
    }
  }
  if (report.needsAttention.length > 0) {
    lines.push('', 'Needs attention');
    for (const item of report.needsAttention) {
      lines.push(`- ${item.company} — ${item.message}`);
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderRunHtml(report: DailyReport): string {
  if (!report.runStats) {
    return '<p><strong>Run:</strong> Manual report; no run statistics recorded.</p>';
  }
  const stats = report.runStats;
  return (
    '<p><strong>Run:</strong> ' +
    `${stats.companiesScanned} companies · ${stats.jobsSeen} jobs seen · ` +
    `${stats.jobsNew} new · ${stats.failures} failures · ${stats.healed} healed · ` +
    `${stats.broken} broken</p>`
  );
}

function renderRunText(report: DailyReport): string {
  if (!report.runStats) {
    return 'Run: manual report; no run statistics recorded.';
  }
  const stats = report.runStats;
  return (
    `Run: ${stats.companiesScanned} companies; ${stats.jobsSeen} jobs seen; ` +
    `${stats.jobsNew} new; ${stats.failures} failures; ${stats.healed} healed; ` +
    `${stats.broken} broken.`
  );
}

function renderJobsHtml(report: DailyReport): string {
  const sections = ['<h2 style="font-size:18px">New jobs</h2>'];
  let jobCount = 0;
  for (const band of BANDS) {
    const jobs = report.newJobsByBand[band];
    if (jobs.length === 0) {
      continue;
    }
    jobCount += jobs.length;
    sections.push(`<h3 style="font-size:16px">Band ${band}</h3>`, renderJobTable(jobs));
  }
  if (jobCount === 0) {
    sections.push('<p>No new jobs.</p>');
  }
  return sections.join('\n');
}

function renderJobTable(jobs: readonly ReportJob[]): string {
  const rows = jobs.map((job) => {
    const titleOnly = job.titleOnly ? ' <em>(title-only)</em>' : '';
    const location = job.location ? escapeHtml(job.location) : 'Location unavailable';
    return (
      '<tr>' +
      `<td style="padding:6px;border-bottom:1px solid #ddd">${job.score}</td>` +
      `<td style="padding:6px;border-bottom:1px solid #ddd">${escapeHtml(job.company)}</td>` +
      '<td style="padding:6px;border-bottom:1px solid #ddd">' +
      `<a href="${escapeAttribute(job.url)}">${escapeHtml(job.title)}</a>${titleOnly}</td>` +
      `<td style="padding:6px;border-bottom:1px solid #ddd">${location}</td>` +
      '</tr>'
    );
  });
  return (
    '<table role="presentation" style="border-collapse:collapse;width:100%">' +
    '<thead><tr><th align="left">Score</th><th align="left">Company</th>' +
    '<th align="left">Role</th><th align="left">Location</th></tr></thead>' +
    `<tbody>${rows.join('')}</tbody></table>`
  );
}

function renderJobText(job: ReportJob): string {
  const marker = job.titleOnly ? ' [title-only]' : '';
  const location = job.location ?? 'Location unavailable';
  return `- ${job.score} · ${job.company} · ${job.title}${marker} · ${location} · ${job.url}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
