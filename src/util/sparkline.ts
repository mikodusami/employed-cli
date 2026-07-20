/** Renders a series of counts as a compact unicode block-character sparkline. */

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Scales each count to the tallest bucket; an all-zero series renders as a flat line. */
export function sparkline(counts: readonly number[]): string {
  if (counts.length === 0) {
    return '';
  }
  const max = Math.max(...counts);
  if (max <= 0) {
    return BLOCKS[0]!.repeat(counts.length);
  }
  return counts
    .map((count) => {
      const level = Math.round((Math.max(0, count) / max) * (BLOCKS.length - 1));
      return BLOCKS[level];
    })
    .join('');
}
