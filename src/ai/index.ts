/** Public AI composition root; feature modules receive only AiRunner or null. */
import type { AiConfig, AppConfig, ProviderName } from '../config/schema.js';
import type { Repositories } from '../db/index.js';
import { NodeProcessRunner, type ProcessRunner } from './process.js';
import { ClaudeCodeProvider } from './providers/claude.js';
import { CodexProvider } from './providers/codex.js';
import { DefaultAiRunner } from './runner.js';
import type { AiProvider, AiRunner } from './types.js';

export * from './errors.js';
export { extractJsonBlock } from './extract.js';
export { renderTemplate } from './templates.js';
export type * from './types.js';

export interface AiDependencies {
  repos: Repositories;
  config: AppConfig;
  processes?: ProcessRunner;
  debug?: (message: string) => void;
}

export function buildAiRunner(dependencies: AiDependencies): AiRunner | null {
  const { config } = dependencies;
  if (!config.ai.enabled) {
    return null;
  }
  const providers = buildAiProviders(config.ai, dependencies.processes, dependencies.debug);
  return providers.length > 0
    ? new DefaultAiRunner(providers, dependencies.repos, config.ai, dependencies.debug)
    : null;
}

export function buildAiProviders(
  config: AiConfig,
  processes: ProcessRunner = new NodeProcessRunner(),
  debug: (message: string) => void = () => undefined,
): AiProvider[] {
  const providers = new Map<ProviderName, AiProvider>([
    ['claude', new ClaudeCodeProvider(processes)],
    ['codex', new CodexProvider(processes, debug)],
  ]);
  return config.preference
    .filter((name) => config.providers[name].enabled)
    .map((name) => providers.get(name))
    .filter((provider): provider is AiProvider => Boolean(provider));
}
