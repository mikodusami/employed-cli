/** Collects diagnostic data without coupling command presentation to providers or SQL. */
import type Database from 'better-sqlite3';

import { ClaudeCodeProvider } from '../ai/providers/claude.js';
import { CodexProvider } from '../ai/providers/codex.js';
import { NodeProcessRunner } from '../ai/process.js';
import type { ProviderName } from '../config/schema.js';
import type { AppConfig } from '../config/schema.js';

export interface ProviderDiagnostic {
  name: ProviderName;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  detail: string | null;
  active: boolean;
}

export interface DatabaseDiagnostic {
  path: string;
  version: number;
  tableCount: number;
  integrity: string;
}

export interface DoctorResult {
  aiDisabled: boolean;
  providers: readonly ProviderDiagnostic[];
  database: DatabaseDiagnostic;
}

export class DoctorService {
  public constructor(
    private readonly database: Database.Database,
    private readonly config: AppConfig,
    private readonly databasePath: string,
  ) {}

  public async inspect(): Promise<DoctorResult> {
    const processes = new NodeProcessRunner();
    const providers = new Map([
      ['claude', new ClaudeCodeProvider(processes)],
      ['codex', new CodexProvider(processes)],
    ] as const);
    const statuses = await Promise.all(
      [...providers].map(async ([name, provider]) => ({
        name,
        status: await provider.isAvailable(),
      })),
    );
    const available = new Set(
      statuses.filter(({ status }) => status.available).map(({ name }) => name),
    );
    const active =
      this.config.ai.preference.find(
        (name) => this.config.ai.providers[name].enabled && available.has(name),
      ) ?? null;

    return {
      aiDisabled: !this.config.ai.enabled,
      providers: statuses.map(({ name, status }) => ({
        name,
        enabled: this.config.ai.enabled && this.config.ai.providers[name].enabled,
        installed: status.available,
        version: status.version,
        detail: status.detail,
        active: this.config.ai.enabled && name === active,
      })),
      database: this.inspectDatabase(),
    };
  }

  private inspectDatabase(): DatabaseDiagnostic {
    const tableCount = this.database
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .get()?.count;
    const integrity = this.database.pragma('integrity_check', { simple: true }) as string;
    const version = this.database.pragma('user_version', { simple: true }) as number;
    return {
      path: this.databasePath,
      version,
      tableCount: tableCount ?? 0,
      integrity,
    };
  }
}
