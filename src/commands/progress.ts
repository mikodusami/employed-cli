/** Binds service stage events to one command-owned live progress line and JSONL stream. */
import type { ProgressHandle } from '../ui/index.js';
import { stage } from '../util/log.js';
import type { CommandContext } from './types.js';

export interface BoundProgress {
  handle: ProgressHandle;
  release(): void;
}

export function bindProgress(
  context: CommandContext,
  title: string,
  prefix: () => string = () => '',
): BoundProgress {
  const handle = context.ui.progress(title);
  const release = context.stages.use((scope, message, data, level = 'info') => {
    const visible = `${prefix()}${message}`;
    const logger = context.log.child(scope);
    if (level === 'info') {
      stage(handle, logger, visible, data ? { ...data } : undefined);
      return;
    }
    handle.step(visible);
    logger.event(level, message, data ? { ...data } : undefined, false);
  });
  return { handle, release };
}
