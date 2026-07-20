/** Resolves implemented scraping sources without leaking adapter selection into services. */
import type { ScrapeMethod } from '../../db/index.js';
import type { HttpClient } from '../../util/http.js';
import type { ScrapeSource } from '../types.js';
import { GreenhouseAdapter } from './greenhouse.js';
import { LeverAdapter } from './lever.js';

interface AdapterDependencies {
  http: HttpClient;
}

type AdapterFactory = (dependencies: AdapterDependencies) => ScrapeSource;

const adapterFactories: Partial<Record<ScrapeMethod, AdapterFactory>> = {
  greenhouse: ({ http }) => new GreenhouseAdapter(http),
  lever: ({ http }) => new LeverAdapter(http),
};

/** Returns the registered source for a method, or null when it is not implemented yet. */
export function getSource(
  method: ScrapeMethod,
  dependencies: AdapterDependencies,
): ScrapeSource | null {
  return adapterFactories[method]?.(dependencies) ?? null;
}
