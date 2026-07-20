/** Memoized robots.txt retrieval and minimal wildcard-agent rule evaluation. */
import { RobotsDisallowedError } from '../errors.js';
import type { HttpClient } from './types.js';

interface RobotsRule {
  allow: boolean;
  path: string;
}

/** Applies User-agent: * Allow/Disallow rules using longest-path precedence. */
export class RobotsGate {
  private readonly rulesByOrigin = new Map<string, Promise<readonly RobotsRule[]>>();

  public constructor(private readonly http: HttpClient) {}

  public async isAllowed(url: string): Promise<boolean> {
    const parsed = new URL(url);
    const rules = await this.getRules(parsed.origin);
    const requestPath = `${parsed.pathname}${parsed.search}`;
    const matches = rules
      .filter((rule) => requestPath.startsWith(rule.path))
      .sort((left, right) => right.path.length - left.path.length || Number(right.allow) - Number(left.allow));
    return matches[0]?.allow ?? true;
  }

  public async assertAllowed(url: string): Promise<void> {
    if (!(await this.isAllowed(url))) {
      throw new RobotsDisallowedError(`robots.txt disallows automated access to ${url}`);
    }
  }

  private getRules(origin: string): Promise<readonly RobotsRule[]> {
    const existing = this.rulesByOrigin.get(origin);
    if (existing) {
      return existing;
    }
    const pending = this.fetchRules(origin);
    this.rulesByOrigin.set(origin, pending);
    return pending;
  }

  private async fetchRules(origin: string): Promise<readonly RobotsRule[]> {
    try {
      const url = new URL('/robots.txt', origin).toString();
      const response = await this.http.fetchText(url);
      if (response.status < 200 || response.status >= 300) {
        return [];
      }
      return parseRobots(response.body);
    } catch {
      return [];
    }
  }
}

/** Parses only wildcard-user-agent groups, sufficient for the application's honest generic UA. */
export function parseRobots(body: string): readonly RobotsRule[] {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];

  const flush = (): void => {
    if (agents.length > 0) {
      groups.push({ agents, rules });
    }
    agents = [];
    rules = [];
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split('#', 1)[0]?.trim() ?? '';
    const separator = line.indexOf(':');
    if (!line || separator < 0) {
      continue;
    }
    const directive = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (directive === 'user-agent') {
      if (rules.length > 0) {
        flush();
      }
      agents.push(value.toLowerCase());
    } else if ((directive === 'allow' || directive === 'disallow') && agents.length > 0) {
      if (value) {
        rules.push({ allow: directive === 'allow', path: value });
      }
    }
  }
  flush();
  return groups.filter((group) => group.agents.includes('*')).flatMap((group) => group.rules);
}
