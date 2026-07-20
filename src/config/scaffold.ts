/** Creates the first-run directory tree and configuration files without clobbering edits. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { LOGS_DIR, REPORTS_DIR } from '../constants.js';
import { APP_CONFIG_TEMPLATE, COMPANIES_TEMPLATE, KEYWORDS_TEMPLATE } from './templates.js';

/** Files created and preserved by one scaffold operation. */
export interface ScaffoldResult {
  created: readonly string[];
  skipped: readonly string[];
}

/** Creates the employed directory structure and missing templates. */
export class ScaffoldService {
  public constructor(private readonly baseDirectory: string) {}

  /** Creates missing assets and never overwrites an existing configuration file. */
  public initialize(): ScaffoldResult {
    mkdirSync(this.baseDirectory, { recursive: true });
    mkdirSync(this.resolveDirectory(REPORTS_DIR, 'reports'), { recursive: true });
    mkdirSync(this.resolveDirectory(LOGS_DIR, 'logs'), { recursive: true });

    const created: string[] = [];
    const skipped: string[] = [];
    const templates = [
      ['config.yaml', APP_CONFIG_TEMPLATE],
      ['companies.yaml', COMPANIES_TEMPLATE],
      ['keywords.yaml', KEYWORDS_TEMPLATE],
    ] as const;

    for (const [fileName, contents] of templates) {
      const filePath = path.join(this.baseDirectory, fileName);
      if (existsSync(filePath)) {
        skipped.push(fileName);
        continue;
      }
      writeFileSync(filePath, contents, { encoding: 'utf8', flag: 'wx' });
      created.push(fileName);
    }

    return { created, skipped };
  }

  private resolveDirectory(defaultPath: string, childName: string): string {
    return this.baseDirectory === path.dirname(defaultPath)
      ? defaultPath
      : path.join(this.baseDirectory, childName);
  }
}
