/** Loads, validates, and memoizes typed YAML configuration. */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { type ZodType, ZodError } from 'zod';

import { EMPLOYED_DIR } from '../constants.js';
import { ConfigError } from '../util/errors.js';
import {
  AppConfigSchema,
  type AppConfig,
  CompaniesFileSchema,
  type CompaniesFile,
  KeywordsFileSchema,
  type KeywordsFile,
} from './schema.js';

/** Loads each configuration file at most once per process. */
export class ConfigService {
  private appConfig?: AppConfig;
  private readonly companiesFiles = new Map<string, CompaniesFile>();
  private keywordsFile?: KeywordsFile;

  public constructor(private readonly baseDirectory = EMPLOYED_DIR) {}

  /** Loads the main application configuration. */
  public loadApp(): AppConfig {
    const filePath = path.join(this.baseDirectory, 'config.yaml');
    if (!this.appConfig) {
      const config = this.load(filePath, AppConfigSchema);
      this.validateEmailCredential(config, filePath);
      this.appConfig = config;
    }
    return this.appConfig;
  }

  /** Loads the company watch list. */
  public loadCompanies(filePath?: string): CompaniesFile {
    const resolvedPath = filePath
      ? path.resolve(filePath)
      : path.join(this.baseDirectory, 'companies.yaml');
    const cachedFile = this.companiesFiles.get(resolvedPath);
    if (cachedFile) {
      return cachedFile;
    }
    const companies = this.load(resolvedPath, CompaniesFileSchema);
    this.companiesFiles.set(resolvedPath, companies);
    return companies;
  }

  /** Loads the keyword scoring profile. */
  public loadKeywords(): KeywordsFile {
    this.keywordsFile ??= this.load(
      path.join(this.baseDirectory, 'keywords.yaml'),
      KeywordsFileSchema,
    );
    return this.keywordsFile;
  }

  private load<Result>(filePath: string, schema: ZodType<Result>): Result {
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

  private validateEmailCredential(config: AppConfig, filePath: string): void {
    if (!config.email.enabled) {
      return;
    }
    const environmentPassword = process.env.EMPLOYED_SMTP_PASSWORD?.trim();
    const filePassword = config.email.smtp.password.trim();
    if (!environmentPassword && !filePassword) {
      throw new ConfigError(
        filePath,
        'email.smtp.password: set EMPLOYED_SMTP_PASSWORD (recommended) or configure a password',
      );
    }
    if (filePassword) {
      const permissions = statSync(filePath).mode & 0o777;
      if (permissions !== 0o600) {
        throw new ConfigError(
          filePath,
          'email.smtp.password: config.yaml must use mode 600; ' +
            'run `chmod 600 ~/.employed/config.yaml`',
        );
      }
    }
  }
}
