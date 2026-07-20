/** Owns all terminal presentation and selects an output mode for the environment. */
import chalk from 'chalk';
import Table from 'cli-table3';
import ora, { type Ora } from 'ora';

import { VERSION } from '../constants.js';
import type { Health } from '../db/index.js';

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
  table(headers: string[], rows: string[][]): void;
}

/** Applies the shared terminal color associated with a scraper health state. */
export function styleHealth(health: Health): string {
  const styles: Readonly<Record<Health, (value: string) => string>> = {
    ok: chalk.green,
    degraded: chalk.yellow,
    broken: chalk.red,
    untested: chalk.dim,
  };
  return styles[health](health);
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

  public table(headers: string[], rows: string[][]): void {
    const healthIndex = headers.findIndex((header) => header.toLowerCase() === 'health');
    const table = new Table({ head: headers.map((header) => chalk.bold(header)) });
    for (const row of rows) {
      const styledRow = [...row];
      const health = styledRow[healthIndex];
      if (healthIndex >= 0 && isHealth(health)) {
        styledRow[healthIndex] = styleHealth(health);
      }
      table.push(styledRow);
    }
    console.log(table.toString());
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

  public table(headers: string[], rows: string[][]): void {
    const widths = headers.map((header, index) =>
      Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
    );
    const formatRow = (row: readonly string[]): string =>
      row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join('  ');
    console.log(formatRow(headers));
    console.log(formatRow(widths.map((width) => '-'.repeat(width))));
    for (const row of rows) {
      console.log(formatRow(row));
    }
  }
}

function isHealth(value: string | undefined): value is Health {
  return value === 'ok' || value === 'degraded' || value === 'broken' || value === 'untested';
}

/** Selects animated output only when explicitly allowed and safe for the terminal. */
export function createUI(isAnimationEnabled = true): UI {
  const isAutomatedEnvironment = Boolean(process.env.CI) || !process.stdout.isTTY;
  return isAnimationEnabled && !isAutomatedEnvironment ? new AnimatedUI() : new PlainUI();
}
