/** Service-neutral stage reporting injected by command orchestration. */
export type StageData = Readonly<Record<string, unknown>>;

export type StageReporter = (
  scope: string,
  message: string,
  data?: StageData,
) => void;

export const NO_STAGE_REPORTER: StageReporter = () => undefined;
