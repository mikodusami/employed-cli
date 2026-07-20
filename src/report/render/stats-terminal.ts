/** Terminal renderer for `StatsReport`; JSON mode consumes the same model directly. */
import type { UI } from '../../ui/index.js';
import type { NudgeItem, StatsReport } from '../stats-model.js';

export function renderStatsTerminal(report: StatsReport, ui: UI): void {
  ui.heading('Stats');

  if (report.totalApplications === 0) {
    ui.info('No applications tracked yet — run `employed apply` or `employed sync` to start.');
    return;
  }

  const applicationWord = report.totalApplications === 1 ? 'application' : 'applications';
  ui.info(
    `${report.totalApplications} ${applicationWord} · ` +
      `${formatRate(report.responseRate)} response rate · ` +
      `${formatRate(report.positiveResponseRate)} positive response rate · ` +
      `${formatRate(report.interviewRate)} interview rate`,
  );
  ui.info(`Avg days to first response: ${formatDays(report.avgDaysToFirstResponse)}`);

  ui.heading('Applications per week (last 12 weeks)');
  ui.output(report.sparkline.chart || '(no data)');

  ui.heading('Outcomes by score band');
  ui.table(
    ['Band', 'Applications', 'Response rate', 'Interview rate'],
    report.outcomesByBand.map((row) => [
      row.band,
      String(row.total),
      formatRate(row.responseRate),
      formatRate(row.interviewRate),
    ]),
  );
  if (report.excludedFromBandTable > 0) {
    ui.info(
      `${report.excludedFromBandTable} application(s) excluded (no linked scraped job or band).`,
    );
  }

  if (report.outcomesByResume.length > 0) {
    ui.heading('Outcomes by résumé version');
    ui.table(
      ['Résumé', 'Applications', 'Response rate', 'Interview rate', 'Signal'],
      report.outcomesByResume.map((row) => [
        row.resumeVersion,
        String(row.total),
        formatRate(row.responseRate),
        formatRate(row.interviewRate),
        row.lowSignal ? 'low' : 'ok',
      ]),
    );
  }

  if (report.keywordCorrelation.length > 0) {
    ui.heading('Keyword → response correlation (directional, not causal)');
    ui.table(
      ['Keyword', 'Applications', 'Response rate'],
      report.keywordCorrelation.map((row) => [
        row.keyword,
        String(row.total),
        formatRate(row.responseRate),
      ]),
    );
  }

  renderNudgeList(ui, 'Consider following up', report.nudges);
  renderNudgeList(ui, 'Probably stale — consider closing', report.stale);
}

function renderNudgeList(ui: UI, heading: string, items: readonly NudgeItem[]): void {
  if (items.length === 0) {
    return;
  }
  ui.heading(heading);
  ui.table(
    ['Application', 'Company', 'Role', 'Status', 'Days quiet'],
    items.map((item) => [
      String(item.applicationId),
      item.company,
      item.role ?? 'Unknown role',
      item.status,
      String(item.daysQuiet),
    ]),
  );
}

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function formatDays(days: number | null): string {
  return days === null ? '—' : `${days.toFixed(1)}d`;
}
