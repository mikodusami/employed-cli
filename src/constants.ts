/**
 * Central application metadata and filesystem locations.
 *
 * @remarks Feature modules must import these paths instead of constructing them.
 */
import path from 'node:path';
import os from 'node:os';

/** Current CLI version, kept in sync with package.json. */
export const VERSION = '0.1.0';

/** Honest identifier sent with employed HTTP requests. */
export const HTTP_USER_AGENT = 'employed/1.0 (+personal job search tool)';

/** Root directory for all user-specific employed data, overridable for isolated runs. */
export const EMPLOYED_DIR = process.env.EMPLOYED_DIR?.trim()
  ? path.resolve(process.env.EMPLOYED_DIR)
  : path.join(os.homedir(), '.employed');

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

/** Pidfile guarding against overlapping `employed run` invocations. */
export const RUN_LOCK_PATH = path.join(EMPLOYED_DIR, 'run.lock');

/** macOS launchd job label and generated agent plist path. */
export const LAUNCHD_LABEL = 'com.employed.daily';
export const LAUNCHD_PLIST_PATH = path.join(
  os.homedir(),
  'Library',
  'LaunchAgents',
  `${LAUNCHD_LABEL}.plist`,
);

/** Comment marker identifying the employed-managed line in the user's Linux crontab. */
export const CRON_MARKER = '# employed-daily (managed by `employed schedule`)';

