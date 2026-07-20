/** Verifies doctor aggregates actionable health without mutating recorded state. */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AiProvider, AiRequest, ProviderStatus } from '../src/ai/types.js';
import { AppConfigSchema, type ProviderName } from '../src/config/schema.js';
import { createDb, Repositories } from '../src/db/index.js';
import type { ScraperConfig } from '../src/scrape/config.js';
import { DoctorService } from '../src/services/doctor.js';

test('doctor surfaces Gmail, SMTP, fleet, crashed-run, and scheduler guidance read-only', async () => {
  const database = createDb(':memory:');
  const repositories = new Repositories(database);
  const company = repositories.companies.insert({
    name: 'Broken Board',
    careers_url: 'https://example.com/jobs',
  });
  repositories.companies.updateMethod(
    company.id,
    'generated-static',
    null,
    JSON.stringify(scraperConfig(0.4)),
  );
  repositories.companies.updateHealth(company.id, 'broken');
  repositories.companies.recordFailure(company.id);
  repositories.runs.start('2026-07-20T07:00:00.000Z');
  const beforeChanges = totalChanges(database);
  const config = AppConfigSchema.parse({
    email: {
      enabled: true,
      to: 'recipient@example.com',
      from: 'sender@example.com',
      smtp: { user: 'sender@example.com', password: 'secret' },
    },
    ai: { providers: { codex: { enabled: false } } },
  });
  const providers = new Map<ProviderName, AiProvider>([
    ['claude', new FakeProvider('claude', true)],
    ['codex', new FakeProvider('codex', false)],
  ]);
  const service = new DoctorService(database, config, ':memory:', repositories, {
    providers,
    homeDirectory: mkdtempSync(path.join(tmpdir(), 'employed-doctor-home-')),
    createEmailVerifier: () => ({
      verify: () => Promise.resolve({ reachable: false, detail: 'authentication failed' }),
    }),
    scheduleService: {
      status: () => ({
        installed: false,
        path: '/tmp/missing.plist',
        time: null,
        nextRun: null,
      }),
    },
  });

  const result = await service.inspect();

  assert.equal(result.gmail.level, 'problem');
  assert.match(result.gmail.fix ?? '', /claude mcp add gmail/);
  assert.equal(result.email.level, 'problem');
  assert.match(result.email.fix ?? '', /EMPLOYED_SMTP_PASSWORD/);
  assert.equal(result.fleet.issues[0]?.company, 'Broken Board');
  assert.equal(result.fleet.issues[0]?.confidence, 0.4);
  assert.match(result.fleet.issues[0]?.fix ?? '', /company generate/);
  assert.equal(result.lastRun?.level, 'problem');
  assert.match(result.lastRun?.fix ?? '', /employed run/);
  assert.equal(result.scheduler.level, 'warning');
  assert.match(result.scheduler.fix ?? '', /schedule install/);
  assert.equal(result.problemCount, 4);
  assert.equal(totalChanges(database), beforeChanges);
  database.close();
});

class FakeProvider implements AiProvider {
  public constructor(
    public readonly name: ProviderName,
    private readonly available: boolean,
  ) {}

  public isAvailable(): Promise<ProviderStatus> {
    return Promise.resolve({
      available: this.available,
      version: this.available ? '1.0.0' : null,
      detail: this.available ? null : 'not installed',
    });
  }

  public run(_request: AiRequest): Promise<string> {
    throw new Error('Doctor must not run a provider task.');
  }
}

function totalChanges(database: ReturnType<typeof createDb>): number {
  return database.prepare<[], { count: number }>('SELECT total_changes() AS count').get()?.count ?? 0;
}

function scraperConfig(confidence: number): ScraperConfig {
  return {
    strategy: 'static',
    listSelector: '.job',
    fields: {
      title: { selector: '.title', attr: 'text' },
      url: { selector: 'a', attr: 'href' },
      location: null,
      department: null,
    },
    pagination: { type: 'none', value: null, maxPages: 1 },
    urlPrefix: null,
    confidence,
    notes: 'Fixture.',
  };
}
