/** Resolves a conservative dot path without evaluating user-supplied expressions. */
export function getAtPath(value: unknown, path: string): unknown {
  if (path.trim() === '') {
    return value;
  }
  let current = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return undefined;
    }
    if (isUnsafeSegment(segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnsafeSegment(segment: string): boolean {
  return segment === '__proto__' || segment === 'prototype' || segment === 'constructor';
}
