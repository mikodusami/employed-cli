/** Service-neutral stage reporting injected by command orchestration. */
import type { LogLevel } from '../util/log.js';

export type StageData = Readonly<Record<string, unknown>>;

export type StageReporter = (
  scope: string,
  message: string,
  data?: StageData,
  level?: LogLevel,
) => void;

export const NO_STAGE_REPORTER: StageReporter = () => undefined;
