/** Best-effort scoped JSONL logging with filtered console delivery. */
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type { ProgressHandle } from '../ui/index.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  child(scope: string): Logger;
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  event(
    level: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
    terminal?: boolean,
  ): void;
  readonly filePath: string | null;
  readonly trace: boolean;
}

export interface LoggerOptions {
  logsDirectory: string;
  command: string;
  consoleLevel?: LogLevel;
  retentionDays?: number;
  trace?: boolean;
  now?: () => Date;
  consoleSink?: (level: LogLevel, message: string) => void;
}

interface LoggerState {
  filePath: string;
  fileEnabled: boolean;
  failureWarned: boolean;
  consoleLevel: LogLevel;
  trace: boolean;
  now: () => Date;
  consoleSink: (level: LogLevel, message: string) => void;
}

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const stageTimes = new WeakMap<ProgressHandle, number>();

class JsonlLogger implements Logger {
  public constructor(
    private readonly state: LoggerState,
    private readonly scope: string,
  ) {}

  public get filePath(): string | null {
    return this.state.fileEnabled ? this.state.filePath : null;
  }

  public get trace(): boolean {
    return this.state.trace;
  }

  public child(scope: string): Logger {
    return new JsonlLogger(this.state, this.scope ? `${this.scope}:${scope}` : scope);
  }

  public debug(msg: string, data?: Record<string, unknown>): void {
    this.event('debug', msg, data);
  }

  public info(msg: string, data?: Record<string, unknown>): void {
    this.event('info', msg, data);
  }

  public warn(msg: string, data?: Record<string, unknown>): void {
    this.event('warn', msg, data);
  }

  public error(msg: string, data?: Record<string, unknown>): void {
    this.event('error', msg, data);
  }

  public event(
    level: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
    terminal = true,
  ): void {
    const logEvent: LogEvent = {
      ts: this.state.now().toISOString(),
      level,
      scope: this.scope || 'app',
      msg,
      ...(data ? { data } : {}),
    };
    if (this.state.fileEnabled) {
      try {
        appendFileSync(this.state.filePath, `${JSON.stringify(logEvent)}\n`, 'utf8');
      } catch (error: unknown) {
        this.state.fileEnabled = false;
        this.warnFileFailure(error);
      }
    }
    if (terminal && LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.state.consoleLevel]) {
      this.state.consoleSink(level, msg);
    }
  }

  private warnFileFailure(error: unknown): void {
    if (this.state.failureWarned) {
      return;
    }
    this.state.failureWarned = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.state.consoleSink('warn', `Structured logging unavailable; continuing: ${reason}`);
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const now = options.now ?? (() => new Date());
  const stamp = formatTimestamp(now());
  const filePath = path.join(options.logsDirectory, `${safeCommand(options.command)}-${stamp}.log`);
  const state: LoggerState = {
    filePath,
    fileEnabled: true,
    failureWarned: false,
    consoleLevel: options.consoleLevel ?? 'info',
    trace: options.trace ?? false,
    now,
    consoleSink: options.consoleSink ?? defaultConsoleSink,
  };
  try {
    mkdirSync(options.logsDirectory, { recursive: true });
    rotateLogs(options.logsDirectory, options.retentionDays ?? 14, now());
    appendFileSync(filePath, '', 'utf8');
  } catch (error: unknown) {
    state.fileEnabled = false;
    const logger = new JsonlLogger(state, 'logger');
    logger.event('warn', 'Structured log initialization failed.', { error: errorMessage(error) });
  }
  return new JsonlLogger(state, '');
}

/** Emits one stage to the live progress view and the durable event stream without duplicate text. */
export function stage(
  handle: ProgressHandle,
  log: Logger,
  msg: string,
  data?: Record<string, unknown>,
): void {
  const now = Date.now();
  const previous = stageTimes.get(handle);
  stageTimes.set(handle, now);
  const elapsedMs = previous === undefined ? 0 : now - previous;
  const display = log.trace ? `${msg} (+${elapsedMs}ms)` : msg;
  handle.step(display);
  log.event('info', msg, log.trace ? { ...data, elapsedMs } : data, false);
}

function rotateLogs(directory: string, retentionDays: number, now: Date): void {
  if (!existsSync(directory)) {
    return;
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1_000;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.log')) {
      continue;
    }
    const filePath = path.join(directory, name);
    if (statSync(filePath).mtimeMs < cutoff) {
      unlinkSync(filePath);
    }
  }
}

function formatTimestamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

function safeCommand(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'command';
}

function defaultConsoleSink(level: LogLevel, message: string): void {
  if (level === 'error') {
    console.error(message);
  } else if (level === 'warn') {
    console.warn(message);
  } else {
    console.log(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
