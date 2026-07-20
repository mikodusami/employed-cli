/** Deterministic extraction of the first complete JSON value from model prose. */

const FENCED_JSON = /```json\s*([\s\S]*?)```/i;

/** Returns a fenced value first, otherwise the first balanced object or array. */
export function extractJsonBlock(raw: string): string | null {
  const fenced = raw.match(FENCED_JSON)?.[1]?.trim();
  if (fenced) {
    return fenced;
  }

  for (let start = 0; start < raw.length; start += 1) {
    const character = raw[start];
    if (character !== '{' && character !== '[') {
      continue;
    }
    const balanced = readBalancedValue(raw, start);
    if (balanced) {
      return balanced;
    }
  }
  return null;
}

function readBalancedValue(raw: string, start: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      stack.push('}');
    } else if (character === '[') {
      stack.push(']');
    } else if (character === '}' || character === ']') {
      if (stack.pop() !== character) {
        return null;
      }
      if (stack.length === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }
  return null;
}
