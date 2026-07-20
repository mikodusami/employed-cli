/** Typed failures exposed by the provider-agnostic AI boundary. */
import type { ProviderName } from '../config/schema.js';
import { AppError } from '../util/errors.js';

export class AiProviderError extends AppError {
  public constructor(
    public readonly provider: ProviderName,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class ProviderUnavailableError extends AiProviderError {}

export class AiUnavailableError extends AppError {}

export class AiBudgetExceededError extends AppError {}

export class AiValidationError extends AppError {
  public constructor(
    message: string,
    public readonly responses: readonly [string, string],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
