/** Resolves implemented scraping sources without leaking adapter selection into services. */
import type { ScrapeMethod } from '../../db/index.js';
import type { HttpClient } from '../../util/http.js';
import type { ScrapeSource } from '../types.js';
import { GeneratedSource } from '../generated.js';
import { AshbyAdapter } from './ashby.js';
import { GreenhouseAdapter } from './greenhouse.js';
import { LeverAdapter } from './lever.js';
import { RecruiteeAdapter } from './recruitee.js';
import { SmartRecruitersAdapter } from './smartrecruiters.js';
import { WorkdayAdapter } from './workday.js';

interface AdapterDependencies {
  http: HttpClient;
}

type AdapterFactory = (dependencies: AdapterDependencies) => ScrapeSource;

const adapterFactories: Partial<Record<ScrapeMethod, AdapterFactory>> = {
  ashby: ({ http }) => new AshbyAdapter(http),
  greenhouse: ({ http }) => new GreenhouseAdapter(http),
  'generated-static': ({ http }) => new GeneratedSource(http),
  lever: ({ http }) => new LeverAdapter(http),
  recruitee: ({ http }) => new RecruiteeAdapter(http),
  smartrecruiters: ({ http }) => new SmartRecruitersAdapter(http),
  workday: ({ http }) => new WorkdayAdapter(http),
};

/** Returns the registered source for a method, or null when it is not implemented yet. */
export function getSource(
  method: ScrapeMethod,
  dependencies: AdapterDependencies,
): ScrapeSource | null {
  return adapterFactories[method]?.(dependencies) ?? null;
}
