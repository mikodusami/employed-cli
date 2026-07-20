/** Verifies configuration defaults, validation, memoization, and safe scaffolding. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ConfigError, ConfigService, ScaffoldService } from '../src/config/index.js';
import {
  AppConfigSchema,
  CompaniesFileSchema,
  KeywordsFileSchema,
} from '../src/config/schema.js';

test('schemas populate every top-level configuration section from an empty mapping', () => {
  assert.deepEqual(AppConfigSchema.parse({}), {
    run: { time: '07:00', concurrency: 4 },
    email: { enabled: false },
    ai: {
      enabled: true,
      preference: ['claude', 'codex'],
      providers: {
        claude: { enabled: true },
        codex: { enabled: true },
      },
      maxCallsPerRun: 10,
    },
  });
  assert.deepEqual(CompaniesFileSchema.parse({}), {
    defaults: { tier: 'B' },
    companies: [],
  });
  assert.deepEqual(KeywordsFileSchema.parse({}), {
    title: {},
    description: {},
    negative: {},
  });
});

test('scaffold templates validate and existing user files are preserved', () => {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), 'employed-config-'));
  const scaffold = new ScaffoldService(baseDirectory);
  const firstResult = scaffold.initialize();
  assert.deepEqual(firstResult.created, ['config.yaml', 'companies.yaml', 'keywords.yaml']);

  const service = new ConfigService(baseDirectory);
  assert.equal(service.loadApp().run.concurrency, 4);
  assert.deepEqual(service.loadApp().ai.preference, ['claude', 'codex']);
  assert.deepEqual(service.loadCompanies().companies, []);
  const keywords = service.loadKeywords();
  assert.equal(keywords.title['new grad'], 6);
  assert.equal(keywords.title['software engineer'], 5);
  assert.equal(keywords.description['machine learning'], 2);
  assert.equal(keywords.negative['10+ years'], 10);
  assert.equal(keywords.negative['phd required'], 6);

  const configPath = path.join(baseDirectory, 'config.yaml');
  const originalConfig = readFileSync(configPath, 'utf8');
  const secondResult = scaffold.initialize();
  assert.deepEqual(secondResult.created, []);
  assert.deepEqual(secondResult.skipped, ['config.yaml', 'companies.yaml', 'keywords.yaml']);
  assert.equal(readFileSync(configPath, 'utf8'), originalConfig);
});

test('ConfigService memoizes files and reports actionable field failures', () => {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), 'employed-validation-'));
  new ScaffoldService(baseDirectory).initialize();
  const service = new ConfigService(baseDirectory);
  const firstConfig = service.loadApp();
  writeFileSync(path.join(baseDirectory, 'config.yaml'), 'run:\n  concurrency: 99\n');
  assert.strictEqual(service.loadApp(), firstConfig);

  const invalidService = new ConfigService(baseDirectory);
  assert.throws(
    () => invalidService.loadApp(),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.message.includes('run.concurrency') &&
      error.message.includes('Too big'),
  );
});

test('missing configuration suggests initialization', () => {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), 'employed-missing-'));
  assert.throws(
    () => new ConfigService(baseDirectory).loadApp(),
    (error: unknown) => error instanceof ConfigError && error.message.includes('employed init'),
  );
});

test('blank YAML files parse to fully populated defaults', () => {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), 'employed-blank-'));
  writeFileSync(path.join(baseDirectory, 'config.yaml'), '');
  writeFileSync(path.join(baseDirectory, 'companies.yaml'), '');
  writeFileSync(path.join(baseDirectory, 'keywords.yaml'), '');
  const service = new ConfigService(baseDirectory);

  assert.equal(service.loadApp().run.time, '07:00');
  assert.deepEqual(service.loadCompanies().companies, []);
  assert.deepEqual(service.loadKeywords().negative, {});
});

test('AI provider settings reject duplicate preferences and accept partial overrides', () => {
  assert.throws(
    () => AppConfigSchema.parse({ ai: { preference: ['claude', 'claude'] } }),
    /AI provider preference entries must be unique/,
  );

  const config = AppConfigSchema.parse({
    ai: { providers: { codex: { enabled: false } } },
  });
  assert.equal(config.ai.providers.claude.enabled, true);
  assert.equal(config.ai.providers.codex.enabled, false);
  assert.deepEqual(config.ai.preference, ['claude', 'codex']);
});

test('ConfigService loads and memoizes a custom company file path', () => {
  const baseDirectory = mkdtempSync(path.join(tmpdir(), 'employed-custom-companies-'));
  const customPath = path.join(baseDirectory, 'custom.yaml');
  writeFileSync(
    customPath,
    'defaults:\n  tier: C\ncompanies:\n  - name: Example\n    url: ftp://invalid-later\n',
  );
  const service = new ConfigService('/unused-default-directory');
  const companies = service.loadCompanies(customPath);

  assert.equal(companies.defaults.tier, 'C');
  assert.equal(companies.companies[0]?.url, 'ftp://invalid-later');
  assert.strictEqual(service.loadCompanies(customPath), companies);
});
