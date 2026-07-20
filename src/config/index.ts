/** Public surface for typed application configuration. */
export { ConfigService } from './loader.js';
export { ConfigError } from '../util/errors.js';
export { ScaffoldService } from './scaffold.js';
export type { ScaffoldResult } from './scaffold.js';
export type {
  AiConfig,
  AppConfig,
  CompaniesFile,
  EmailConfig,
  KeywordsFile,
  ProviderName,
  StatsConfig,
} from './schema.js';
export type { KnownAtsFile } from '../scrape/known-ats.js';
