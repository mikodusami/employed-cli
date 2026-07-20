/**
 * Central application metadata and filesystem locations.
 *
 * @remarks Feature modules must import these paths instead of constructing them.
 */
import path from 'node:path';
import os from 'node:os';

/** Current CLI version, kept in sync with package.json. */
export const VERSION = '0.1.0';

/** Root directory for all user-specific employed data. */
export const EMPLOYED_DIR = path.join(os.homedir(), '.employed');

/** SQLite database location. */
export const DB_PATH = path.join(EMPLOYED_DIR, 'employed.db');

/** User configuration location. */
export const CONFIG_PATH = path.join(EMPLOYED_DIR, 'config.yaml');

/** Company watch-list configuration location. */
export const COMPANIES_PATH = path.join(EMPLOYED_DIR, 'companies.yaml');

/** Job-scoring keyword configuration location. */
export const KEYWORDS_PATH = path.join(EMPLOYED_DIR, 'keywords.yaml');

/** Generated report directory. */
export const REPORTS_DIR = path.join(EMPLOYED_DIR, 'reports');

/** Application log directory. */
export const LOGS_DIR = path.join(EMPLOYED_DIR, 'logs');
