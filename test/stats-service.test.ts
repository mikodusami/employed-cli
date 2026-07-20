/** Verifies event-scan metrics against hand-computed values, cross-tabs, and graceful zero-data. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AppConfigSchema } from '../src/config/schema.js';
import { createDb, Repositories } from '../src/db/index.js';
import { StatsService } from '../src/services/stats.js';

const STATS_CONFIG = AppConfigSchema.parse({
  stats: { followUpDays: 7, staleDays: 21, minKeywordSample: 2, minResumeSample: 2 },
}).stats;

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = new Date('2026-01-01T00:00:00.000Z').getTime();

function iso(dayOffset: number): string {
  return new Date(BASE + dayOffset * DAY_MS).toISOString();
}

test('event-scan metrics, cross-tabs, and keyword correlation match hand-computed values', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = repositories.companies.insert({
    name: 'Acme',
    careers_url: 'https://example.com/careers',
  });

  const job = (title: string, band: 'A' | 'B' | 'C' | 'D', keywords: string[], dedupe: string) =>
    repositories.jobs.upsert({
      company_id: company.id,
      title,
      url: `https://example.com/jobs/${dedupe}`,
      first_seen: iso(0),
      last_seen: iso(0),
      dedupe_key: dedupe,
      band,
      score: 0,
      matched_kw: JSON.stringify(keywords),
    }).job;

  const j1 = job('Backend A1', 'A', ['python', 'remote'], 'j1');
  const j2 = job('Backend A2', 'A', ['python'], 'j2');
  const j3 = job('Backend B1', 'B', ['java'], 'j3');
  const j4 = job('Backend B2', 'B', ['java', 'remote'], 'j4');
  const j5 = job('Backend C1', 'C', ['python', 'java'], 'j5');
  const j6 = job('Backend D1', 'D', ['docker'], 'j6');

  // App1: applied -> interview (responded, positive, interviewed; first response day 3).
  const app1 = repositories.applications.create(
    {
      job_id: j1.id,
      company_name: 'Acme',
      status: 'interview',
      applied_at: iso(0),
      resume_version: 'v1',
    },
    iso(0),
  );
  repositories.events.append({ application_id: app1.id, at: iso(0), type: 'applied' });
  repositories.events.append({ application_id: app1.id, at: iso(3), type: 'interview' });
  repositories.applications.setFirstResponse(app1.id, iso(3));

  // App2: applied -> rejected directly (responded, NOT positive, not interviewed; response day 5).
  const app2 = repositories.applications.create(
    {
      job_id: j2.id,
      company_name: 'Acme',
      status: 'rejected',
      applied_at: iso(0),
      resume_version: 'v1',
    },
    iso(0),
  );
  repositories.events.append({ application_id: app2.id, at: iso(0), type: 'applied' });
  repositories.events.append({ application_id: app2.id, at: iso(5), type: 'rejected' });
  repositories.applications.setFirstResponse(app2.id, iso(5));

  // App3: applied -> interview -> rejected. Interview rate must still count this (event-scan,
  // not current status) even though the application ended up rejected.
  const app3 = repositories.applications.create(
    {
      job_id: j3.id,
      company_name: 'Acme',
      status: 'rejected',
      applied_at: iso(0),
      resume_version: 'v2',
    },
    iso(0),
  );
  repositories.events.append({ application_id: app3.id, at: iso(0), type: 'applied' });
  repositories.events.append({ application_id: app3.id, at: iso(2), type: 'interview' });
  repositories.events.append({ application_id: app3.id, at: iso(10), type: 'rejected' });
  repositories.applications.setFirstResponse(app3.id, iso(2)); // set once, on the first response

  // App4: applied only, no response yet.
  const app4 = repositories.applications.create(
    { job_id: j4.id, company_name: 'Acme', status: 'applied', applied_at: iso(0) },
    iso(0),
  );
  repositories.events.append({ application_id: app4.id, at: iso(0), type: 'applied' });

  // App5: applied -> oa (responded, positive, not interviewed; response day 1).
  const app5 = repositories.applications.create(
    { job_id: j5.id, company_name: 'Acme', status: 'oa', applied_at: iso(0) },
    iso(0),
  );
  repositories.events.append({ application_id: app5.id, at: iso(0), type: 'applied' });
  repositories.events.append({ application_id: app5.id, at: iso(1), type: 'oa' });
  repositories.applications.setFirstResponse(app5.id, iso(1));

  // App6: linked to a job whose only keyword ("docker") should be excluded (1 app < min sample 2).
  const app6 = repositories.applications.create(
    { job_id: j6.id, company_name: 'Acme', status: 'applied', applied_at: iso(0) },
    iso(0),
  );
  repositories.events.append({ application_id: app6.id, at: iso(0), type: 'applied' });

  // App7: manual (no linked job) — excluded from the band table with a footnote count.
  repositories.applications.create(
    { company_name: 'Manual Co', status: 'applied', applied_at: iso(0) },
    iso(0),
  );

  const service = new StatsService(database, STATS_CONFIG);
  const report = service.compute(new Date(iso(30)));

  assert.equal(report.totalApplications, 7);
  assert.equal(report.responseRate, 4 / 7);
  assert.equal(report.positiveResponseRate, 3 / 7);
  assert.equal(report.interviewRate, 2 / 7, 'app3 counts: interviewed even though later rejected');
  assert.equal(report.avgDaysToFirstResponse, (3 + 5 + 2 + 1) / 4);

  assert.equal(report.excludedFromBandTable, 1);
  const byBand = new Map(report.outcomesByBand.map((row) => [row.band, row]));
  assert.deepEqual(byBand.get('A'), { band: 'A', total: 2, responseRate: 1, interviewRate: 0.5 });
  assert.deepEqual(byBand.get('B'), { band: 'B', total: 2, responseRate: 0.5, interviewRate: 0.5 });
  assert.deepEqual(byBand.get('C'), { band: 'C', total: 1, responseRate: 1, interviewRate: 0 });
  assert.deepEqual(byBand.get('D'), { band: 'D', total: 1, responseRate: 0, interviewRate: 0 });

  const byResume = new Map(report.outcomesByResume.map((row) => [row.resumeVersion, row]));
  assert.deepEqual(byResume.get('v1'), {
    resumeVersion: 'v1',
    total: 2,
    responseRate: 1,
    interviewRate: 0.5,
    lowSignal: false,
  });
  assert.deepEqual(byResume.get('v2'), {
    resumeVersion: 'v2',
    total: 1,
    responseRate: 1,
    interviewRate: 1,
    lowSignal: true,
  });

  const byKeyword = new Map(report.keywordCorrelation.map((row) => [row.keyword, row]));
  assert.equal(byKeyword.has('docker'), false, 'below the min-sample floor of 2');
  assert.deepEqual(byKeyword.get('python'), { keyword: 'python', total: 3, responseRate: 1 });
  assert.deepEqual(byKeyword.get('remote'), { keyword: 'remote', total: 2, responseRate: 0.5 });
  assert.ok(Math.abs((byKeyword.get('java')?.responseRate ?? 0) - 2 / 3) < 1e-9);

  // --json round-trips to the same serializable shape.
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  database.close();
});

test('an independent event-diff computation matches the first_response_at-based average', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const app = repositories.applications.create(
    { company_name: 'Acme', applied_at: iso(0) },
    iso(0),
  );
  repositories.events.append({ application_id: app.id, at: iso(0), type: 'applied' });
  repositories.events.append({ application_id: app.id, at: iso(4), type: 'interview' });
  repositories.applications.setFirstResponse(app.id, iso(4));

  const events = repositories.events.listForApplication(app.id);
  const firstNonApplied = events.find((event) => event.type !== 'applied');
  const appliedAt = new Date(iso(0)).getTime();
  const independentDays = firstNonApplied
    ? (new Date(firstNonApplied.at).getTime() - appliedAt) / DAY_MS
    : null;

  const report = new StatsService(database, STATS_CONFIG).compute(new Date(iso(30)));
  assert.equal(report.avgDaysToFirstResponse, independentDays);
  database.close();
});

test('nudges and stale lists select by age threshold and exclude terminal statuses', () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const now = iso(100);

  const active = repositories.applications.create({ company_name: 'NudgeMe' }, iso(0));
  repositories.applications.touchActivity(active.id, iso(100 - 10)); // 10 days quiet -> nudge

  const veryQuiet = repositories.applications.create({ company_name: 'StaleCo' }, iso(0));
  repositories.applications.updateStatus(veryQuiet.id, 'interview');
  repositories.applications.touchActivity(veryQuiet.id, iso(100 - 30)); // 30 days -> stale

  const recentlyActive = repositories.applications.create({ company_name: 'FreshCo' }, iso(0));
  repositories.applications.touchActivity(recentlyActive.id, iso(100 - 2)); // 2 days -> neither

  const terminalButQuiet = repositories.applications.create({ company_name: 'DoneCo' }, iso(0));
  repositories.applications.updateStatus(terminalButQuiet.id, 'rejected');
  // 200 days quiet, but terminal -> excluded from both lists.
  repositories.applications.touchActivity(terminalButQuiet.id, iso(100 - 200));

  const report = new StatsService(database, STATS_CONFIG).compute(new Date(now));

  assert.deepEqual(
    report.nudges.map((item) => item.applicationId),
    [active.id],
  );
  assert.deepEqual(
    report.stale.map((item) => item.applicationId),
    [veryQuiet.id],
  );
  assert.equal(
    report.nudges.concat(report.stale).some((item) => item.applicationId === recentlyActive.id),
    false,
  );
  assert.equal(
    report.nudges.concat(report.stale).some((item) => item.applicationId === terminalButQuiet.id),
    false,
  );
  database.close();
});

test('a database with zero applications renders every rate as null, not NaN', () => {
  const database = createDb(':memory:');
  const report = new StatsService(database, STATS_CONFIG).compute(new Date(iso(0)));

  assert.equal(report.totalApplications, 0);
  assert.equal(report.responseRate, null);
  assert.equal(report.positiveResponseRate, null);
  assert.equal(report.interviewRate, null);
  assert.equal(report.avgDaysToFirstResponse, null);
  assert.equal(report.excludedFromBandTable, 0);
  assert.deepEqual(report.outcomesByBand.map((row) => row.total), [0, 0, 0, 0]);
  assert.deepEqual(report.outcomesByResume, []);
  assert.deepEqual(report.keywordCorrelation, []);
  assert.deepEqual(report.nudges, []);
  assert.deepEqual(report.stale, []);
  assert.equal(report.sparkline.chart, '▁'.repeat(12));
  database.close();
});

test('stats issues zero HTTP or AI calls: no such imports anywhere in this unit', () => {
  const statsSource = readFileSync(new URL('../src/services/stats.ts', import.meta.url), 'utf8');
  const queriesSource = readFileSync(
    new URL('../src/services/stats-queries.ts', import.meta.url),
    'utf8',
  );
  for (const source of [statsSource, queriesSource]) {
    assert.doesNotMatch(source, /from '\.\.\/util\/http/);
    assert.doesNotMatch(source, /from '\.\.\/ai\//);
  }
});
