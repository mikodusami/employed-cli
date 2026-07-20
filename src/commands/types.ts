/** Defines the common contract implemented by every CLI command module. */
import type Database from 'better-sqlite3';
import type { Command } from 'commander';

import type { ConfigService } from '../config/index.js';
import type { Repositories } from '../db/index.js';
import type { UI } from '../ui/index.js';

/** Dependencies shared by command orchestration code. */
export interface CommandContext {
  ui: UI;
  config: ConfigService;
  database: Database.Database;
  repositories: Repositories;
}

/** Registers one command and its options on the root program. */
export type RegisterCommand = (program: Command, context: CommandContext) => void;
