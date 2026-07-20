/** Loads, validates, and memoizes typed YAML configuration. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { type ZodType, ZodError } from 'zod';

import { EMPLOYED_DIR } from '../constants.js';
import {
  AppConfigSchema,
  type AppConfig,
  CompaniesFileSchema,
  type CompaniesFile,
  KeywordsFileSchema,
  type KeywordsFile,
} from './schema.js';

/** A user-actionable configuration read or validation failure. */
export class ConfigError extends Error {
  public readonly filePath: string;

  public constructor(filePath: string, details: string, options?: ErrorOptions) {
    super(`Invalid configuration at ${filePath}:\n${details}`, options);
    this.name = 'ConfigError';
    this.filePath = filePath;
  }
}

/** Loads each configuration file at most once per process. */
export class ConfigService {
  private appConfig?: AppConfig;
  private companiesFile?: CompaniesFile;
  private keywordsFile?: KeywordsFile;

  public constructor(private readonly baseDirectory = EMPLOYED_DIR) {}

  /** Loads the main application configuration. */
  public loadApp(): AppConfig {
    this.appConfig ??= this.load('config.yaml', AppConfigSchema);
    return this.appConfig;
  }

  /** Loads the company watch list. */
  public loadCompanies(): CompaniesFile {
    this.companiesFile ??= this.load('companies.yaml', CompaniesFileSchema);
    return this.companiesFile;
  }

  /** Loads the keyword scoring profile. */
  public loadKeywords(): KeywordsFile {
    this.keywordsFile ??= this.load('keywords.yaml', KeywordsFileSchema);
    return this.keywordsFile;
  }

  private load<Result>(fileName: string, schema: ZodType<Result>): Result {
    const filePath = path.join(this.baseDirectory, fileName);
    let source: string;

    try {
      source = readFileSync(filePath, 'utf8');
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      const hint =
        code === 'ENOENT' ? 'File is missing. Run `employed init` first.' : String(error);
      throw new ConfigError(filePath, hint, { cause: error });
    }

    try {
      return schema.parse(parseYaml(source) ?? {});
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        const details = error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('\n');
        throw new ConfigError(filePath, details, { cause: error });
      }
      throw new ConfigError(filePath, `YAML could not be parsed: ${String(error)}`, {
        cause: error,
      });
    }
  }
}
