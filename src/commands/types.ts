/** Defines the common contract implemented by every CLI command module. */
import type Database from 'better-sqlite3';
import type { Command } from 'commander';

import type { AiRunner } from '../ai/index.js';
import type { ConfigService } from '../config/index.js';
import type { Repositories } from '../db/index.js';
import type { AtsDetector } from '../scrape/detect.js';
import type { UI } from '../ui/index.js';
import type { HttpClient } from '../util/http.js';
import type { Logger } from '../util/log.js';

/** Dependencies shared by command orchestration code. */
export interface CommandContext {
  ui: UI;
  config: ConfigService;
  db: Database.Database;
  repos: Repositories;
  detector: AtsDetector;
  http: HttpClient;
  ai: AiRunner | null;
  log: Logger;
}

/** Registers one command and its options on the root program. */
export type RegisterCommand = (program: Command, context: CommandContext) => void;
