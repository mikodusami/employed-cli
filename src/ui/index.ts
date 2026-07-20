/** Owns all terminal presentation and selects an output mode for the environment. */
import chalk from 'chalk';
import Table from 'cli-table3';
import ora, { type Ora } from 'ora';

import { VERSION } from '../constants.js';
import type { Band, Health } from '../db/index.js';

const PALETTE = {
  green: chalk.hex('#4ADE80'),
  cyan: chalk.hex('#22D3EE'),
  yellow: chalk.hex('#FACC15'),
  red: chalk.hex('#F87171'),
  dim: chalk.gray,
} as const;

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
  output(message: string): void;
  banner(): void;
  table(headers: string[], rows: string[][]): void;
}

/** Applies the shared terminal color associated with a scraper health state. */
export function styleHealth(health: Health): string {
  const styles: Readonly<Record<Health, (value: string) => string>> = {
    ok: PALETTE.green,
    degraded: PALETTE.yellow,
    broken: PALETTE.red,
    untested: PALETTE.dim,
  };
  return styles[health](health);
}

/** Applies the shared terminal color associated with a score band. */
export function styleBand(band: Band): string {
  const styles: Readonly<Record<Band, (value: string) => string>> = {
    A: PALETTE.green,
    B: PALETTE.cyan,
    C: PALETTE.yellow,
    D: PALETTE.dim,
  };
  return styles[band](band);
}

class AnimatedSpinner implements Spinner {
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  public constructor(
    private readonly indicator: Ora,
    private readonly beforeStart: () => void,
  ) {}

  public start(): Spinner {
    this.beforeStart();
    this.timer = setTimeout(() => {
      this.started = true;
      this.indicator.start();
    }, 100);
    return this;
  }

  public succeed(text?: string): Spinner {
    this.cancelDelay();
    if (this.started) {
      this.indicator.succeed(text);
    } else {
      console.log(PALETTE.green(`✓ ${text ?? this.indicator.text}`));
    }
    return this;
  }

  public fail(text?: string): Spinner {
    this.cancelDelay();
    if (this.started) {
      this.indicator.fail(text);
    } else {
      console.error(PALETTE.red(`✗ ${text ?? this.indicator.text}`));
    }
    return this;
  }

  public update(text: string): Spinner {
    this.indicator.text = text;
    return this;
  }

  private cancelDelay(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

class AnimatedUI implements UI {
  private hasBanner = false;

  public spinner(text: string): Spinner {
    return new AnimatedSpinner(ora({ text, spinner: 'dots12' }), () => this.ensureBanner());
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
    this.ensureBanner();
    console.log(chalk.bold.underline(message));
  }

  public output(message: string): void {
    console.log(message);
  }

  public banner(): void {
    this.ensureBanner();
  }

  public table(headers: string[], rows: string[][]): void {
    this.ensureBanner();
    const healthIndex = headers.findIndex((header) => header.toLowerCase() === 'health');
    const bandIndex = headers.findIndex((header) => header.toLowerCase() === 'band');
    const table = new Table({ head: headers.map((header) => chalk.bold(header)) });
    for (const row of rows) {
      const styledRow = [...row];
      const health = styledRow[healthIndex];
      if (healthIndex >= 0 && isHealth(health)) {
        styledRow[healthIndex] = styleHealth(health);
      }
      const band = styledRow[bandIndex];
      if (bandIndex >= 0 && isBand(band)) {
        styledRow[bandIndex] = styleBand(band);
      }
      table.push(styledRow);
    }
    console.log(table.toString());
  }

  private ensureBanner(): void {
    if (this.hasBanner) {
      return;
    }
    this.hasBanner = true;
    const lines = [
      '  ___ _ __ ___  _ __ | | ___  _   _  ___  __| |',
      " / _ \\ '_ ` _ \\| '_ \\| |/ _ \\| | | |/ _ \\/ _` |",
      '|  __/ | | | | | |_) | | (_) | |_| |  __/ (_| |',
      ' \\___|_| |_| |_| .__/|_|\\___/ \\__, |\\___|\\__,_|',
      '               |_|           |___/                 ',
    ];
    const colors = ['#22D3EE', '#38BDF8', '#818CF8', '#A78BFA', '#C084FC'];
    lines.forEach((line, index) => console.log(chalk.hex(colors[index] ?? '#22D3EE')(line)));
    console.log(chalk.dim(`  v${VERSION} · your job search, in motion\n`));
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

  public output(message: string): void {
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

function isBand(value: string | undefined): value is Band {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D';
}

/** Selects animated output only when explicitly allowed and safe for the terminal. */
export function createUI(isAnimationEnabled = true): UI {
  const isAutomatedEnvironment = Boolean(process.env.CI) || !process.stdout.isTTY;
  return isAnimationEnabled && !isAutomatedEnvironment ? new AnimatedUI() : new PlainUI();
}
