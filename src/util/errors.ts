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
