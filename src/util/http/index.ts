/** Stable public surface and composition root for application HTTP behavior. */
import type Database from 'better-sqlite3';

import type { AppConfig } from '../../config/schema.js';
import { CachingHttpClient } from './cache.js';
import { UndiciHttpClient } from './client.js';
import { PoliteHttpClient } from './politeness.js';
import { RetryHttpClient } from './retry.js';

export { CachingHttpClient } from './cache.js';
export { UndiciHttpClient } from './client.js';
export { PoliteHttpClient, registrableDomain } from './politeness.js';
export { RetryHttpClient } from './retry.js';
export { parseRobots, RobotsGate } from './robots.js';
export type { FetchOpts, FetchResult, HttpClient } from './types.js';
export { HttpError, RobotsDisallowedError } from '../errors.js';

export interface HttpClientDependencies {
  db: Database.Database;
  config: AppConfig;
  onCacheHit?: (url: string) => void;
}

/** Builds the one HTTP stack shared by detection, adapters, and future generated scrapers. */
export function buildHttpClient({
  db,
  config,
  onCacheHit,
}: HttpClientDependencies): RetryHttpClient {
  const cached = new CachingHttpClient(new UndiciHttpClient(), db, () => new Date(), onCacheHit);
  const polite = new PoliteHttpClient(cached, {
    concurrency: config.run.concurrency,
    jitterMs: config.run.jitterMs,
  });
  // Retry is outermost so every new attempt calls back through politeness and cache revalidation.
  return new RetryHttpClient(polite, { maxAttempts: config.run.maxRetries });
}
