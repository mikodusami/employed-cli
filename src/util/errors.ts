/** Defines expected, user-actionable application errors. */

/** Base class for failures that should be rendered without a stack trace. */
export class AppError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Indicates invalid user or configuration input. */
export class ValidationError extends AppError {}

/** Indicates a network or timeout failure before an HTTP response was received. */
export class HttpError extends AppError {}

/** Indicates SMTP verification or digest-delivery failure. */
export class EmailError extends AppError {}

/** Indicates an ATS response or adapter contract failure. */
export class AdapterError extends AppError {}

/** Indicates that robots.txt forbids an automated request path. */
export class RobotsDisallowedError extends AppError {}

/** Indicates that a generated scraper needs a browser-rendered execution strategy. */
export class RequiresRenderError extends AppError {}

/** Indicates that an evidence capture exceeded its absolute wall-clock deadline. */
export class CaptureTimeoutError extends AppError {}

/** Indicates a configuration read, parse, or validation failure. */
export class ConfigError extends AppError {
  public constructor(
    public readonly filePath: string,
    details: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid configuration at ${filePath}:\n${details}`, options);
  }
}
