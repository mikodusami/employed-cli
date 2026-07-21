/** Loads versioned prompt assets and rejects incomplete placeholder rendering. */
import { readFileSync } from 'node:fs';

import { ValidationError } from '../util/errors.js';

const TEMPLATE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const UNRESOLVED_PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const PROMPTS_DIRECTORY = new URL('../../prompts/', import.meta.url);

export function renderTemplate(
  templateId: string,
  values: Readonly<Record<string, string>>,
): string {
  if (!TEMPLATE_ID.test(templateId)) {
    throw new ValidationError(`Invalid prompt template ID: ${templateId}`);
  }
  let rendered = readFileSync(new URL(`${templateId}.txt`, PROMPTS_DIRECTORY), 'utf8');
  const required = [...rendered.matchAll(UNRESOLVED_PLACEHOLDER)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  const missing = [...new Set(required)].filter((name) => values[name] === undefined);
  if (missing.length > 0) {
    throw new ValidationError(
      `Prompt ${templateId} has unresolved placeholders: ${missing.join(', ')}`,
    );
  }
  for (const [name, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{${name}}`, value);
  }
  return rendered;
}
