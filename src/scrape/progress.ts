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

/** Lets a long-lived service publish into the progress handle owned by the active command. */
export class StageBus {
  private sink: StageReporter = NO_STAGE_REPORTER;

  public readonly report: StageReporter = (scope, message, data, level) => {
    this.sink(scope, message, data, level);
  };

  public use(sink: StageReporter): () => void {
    this.sink = sink;
    return () => {
      if (this.sink === sink) {
        this.sink = NO_STAGE_REPORTER;
      }
    };
  }
}
