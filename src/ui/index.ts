/** Owns all terminal presentation and selects an output mode for the environment. */
import chalk from 'chalk';
import ora, { type Ora } from 'ora';

import { VERSION } from '../constants.js';

/** A progress indicator with animated and plain-text implementations. */
export interface Spinner {
  start(): Spinner;
  succeed(text?: string): Spinner;
  fail(text?: string): Spinner;
  update(text: string): Spinner;
}

/** Terminal output capabilities available to commands. */
export interface UI {
  spinner(text: string): Spinner;
  success(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  heading(message: string): void;
  banner(): void;
}

class AnimatedSpinner implements Spinner {
  public constructor(private readonly indicator: Ora) {}

  public start(): Spinner {
    this.indicator.start();
    return this;
  }

  public succeed(text?: string): Spinner {
    this.indicator.succeed(text);
    return this;
  }

  public fail(text?: string): Spinner {
    this.indicator.fail(text);
    return this;
  }

  public update(text: string): Spinner {
    this.indicator.text = text;
    return this;
  }
}

class AnimatedUI implements UI {
  public spinner(text: string): Spinner {
    return new AnimatedSpinner(ora(text));
  }

  public success(message: string): void {
    console.log(chalk.green(`✓ ${message}`));
  }

  public error(message: string): void {
    console.error(chalk.red(`✗ ${message}`));
  }

  public warn(message: string): void {
    console.warn(chalk.yellow(`! ${message}`));
  }

  public info(message: string): void {
    console.log(chalk.cyan(`i ${message}`));
  }

  public heading(message: string): void {
    console.log(chalk.bold.underline(message));
  }

  public banner(): void {
    console.log(chalk.bold.cyan(`employed v${VERSION}`));
  }
}

class PlainSpinner implements Spinner {
  private hasStarted = false;

  public constructor(private text: string) {}

  public start(): Spinner {
    console.log(this.text);
    this.hasStarted = true;
    return this;
  }

  public succeed(text?: string): Spinner {
    console.log(`✓ ${text ?? this.text}`);
    return this;
  }

  public fail(text?: string): Spinner {
    console.error(`✗ ${text ?? this.text}`);
    return this;
  }

  public update(text: string): Spinner {
    this.text = text;
    if (this.hasStarted) {
      console.log(text);
    }
    return this;
  }
}

class PlainUI implements UI {
  public spinner(text: string): Spinner {
    return new PlainSpinner(text);
  }

  public success(message: string): void {
    console.log(`✓ ${message}`);
  }

  public error(message: string): void {
    console.error(`✗ ${message}`);
  }

  public warn(message: string): void {
    console.warn(`! ${message}`);
  }

  public info(message: string): void {
    console.log(`i ${message}`);
  }

  public heading(message: string): void {
    console.log(message);
  }

  public banner(): void {
    console.log(`employed v${VERSION}`);
  }
}

/** Selects animated output only when explicitly allowed and safe for the terminal. */
export function createUI(isAnimationEnabled = true): UI {
  const isAutomatedEnvironment = Boolean(process.env.CI) || !process.stdout.isTTY;
  return isAnimationEnabled && !isAutomatedEnvironment ? new AnimatedUI() : new PlainUI();
}
