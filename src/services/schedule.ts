/** Generates and installs the OS-level artifact that fires `employed run` on a schedule. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CRON_MARKER, LAUNCHD_LABEL, LAUNCHD_PLIST_PATH, LOGS_DIR } from '../constants.js';
import { AppError, ValidationError } from '../util/errors.js';

/** Thrown when scheduling is requested on a platform employed does not support. */
export class UnsupportedPlatformError extends AppError {}

/** The generated OS artifact, shown to the user before anything is written. */
export interface ScheduleArtifact {
  path: string;
  content: string;
}

export interface ScheduleStatus {
  installed: boolean;
  path: string;
  time: string | null;
  nextRun: string | null;
}

interface CommandOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs an OS command; injectable so tests never touch the real scheduler. */
export type CommandRunner = (
  binary: string,
  args: readonly string[],
  input?: string,
) => CommandOutcome;

const defaultCommandRunner: CommandRunner = (binary, args, input) => {
  const result = spawnSync(binary, [...args], { input, encoding: 'utf8', shell: false });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

export interface ScheduleServiceOptions {
  platform?: NodeJS.Platform;
  binaryPath?: string;
  scriptPath?: string;
  logsDir?: string;
  plistPath?: string;
  runCommand?: CommandRunner;
}

const CRONTAB_ARTIFACT_LABEL = 'crontab';

/** OS-detecting installer for the daily scheduled `employed run`. */
export class ScheduleService {
  private readonly platform: NodeJS.Platform;
  private readonly binaryPath: string;
  private readonly scriptPath: string;
  private readonly logsDir: string;
  private readonly plistPath: string;
  private readonly runCommand: CommandRunner;

  public constructor(options: ScheduleServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.binaryPath = options.binaryPath ?? process.execPath;
    this.scriptPath = options.scriptPath ?? path.resolve(process.argv[1] ?? '');
    this.logsDir = options.logsDir ?? LOGS_DIR;
    this.plistPath = options.plistPath ?? LAUNCHD_PLIST_PATH;
    this.runCommand = options.runCommand ?? defaultCommandRunner;
  }

  /** Renders the artifact for the current platform without touching disk or the OS scheduler. */
  public buildArtifact(at: string): ScheduleArtifact {
    const { hour, minute } = parseTime(at);
    if (this.platform === 'darwin') {
      return { path: this.plistPath, content: this.buildPlist(hour, minute) };
    }
    if (this.platform === 'linux') {
      return { path: CRONTAB_ARTIFACT_LABEL, content: this.buildCronLine(hour, minute) };
    }
    throw new UnsupportedPlatformError(
      `Scheduling is only supported on macOS and Linux, not ${this.platform}.`,
    );
  }

  /** Writes the artifact and loads it into the OS scheduler; refuses to clobber silently. */
  public install(at: string, force = false): ScheduleArtifact {
    const artifact = this.buildArtifact(at);
    if (!force && this.isInstalled()) {
      throw new ValidationError(
        'employed is already scheduled. Run `employed schedule remove` first, or pass --force.',
      );
    }

    mkdirSync(this.logsDir, { recursive: true });
    if (this.platform === 'darwin') {
      this.installLaunchd(artifact);
    } else {
      this.installCron(artifact);
    }
    return artifact;
  }

  /** Unloads and removes the installed artifact; returns false when nothing was installed. */
  public remove(): boolean {
    if (this.platform === 'darwin') {
      if (!existsSync(this.plistPath)) {
        return false;
      }
      this.runCommand('launchctl', ['unload', this.plistPath]);
      rmSync(this.plistPath);
      return true;
    }
    return this.removeCronLine();
  }

  public status(): ScheduleStatus {
    if (this.platform === 'darwin') {
      if (!existsSync(this.plistPath)) {
        return { installed: false, path: this.plistPath, time: null, nextRun: null };
      }
      const time = extractPlistTime(readFileSync(this.plistPath, 'utf8'));
      return {
        installed: true,
        path: this.plistPath,
        time,
        nextRun: time ? nextOccurrence(time).toISOString() : null,
      };
    }
    const existing = this.findCronLine();
    if (!existing) {
      return { installed: false, path: CRONTAB_ARTIFACT_LABEL, time: null, nextRun: null };
    }
    const time = extractCronTime(existing);
    return {
      installed: true,
      path: CRONTAB_ARTIFACT_LABEL,
      time,
      nextRun: time ? nextOccurrence(time).toISOString() : null,
    };
  }

  private isInstalled(): boolean {
    if (this.platform === 'darwin') {
      return existsSync(this.plistPath);
    }
    return this.findCronLine() !== null;
  }

  private installLaunchd(artifact: ScheduleArtifact): void {
    mkdirSync(path.dirname(this.plistPath), { recursive: true });
    writeFileSync(this.plistPath, artifact.content, 'utf8');
    // Unload first: `load` on an already-loaded label is a silent no-op on changed content.
    this.runCommand('launchctl', ['unload', this.plistPath]);
    this.runCommand('launchctl', ['load', '-w', this.plistPath]);
  }

  private installCron(artifact: ScheduleArtifact): void {
    const currentLines = this.readCrontabLines().filter((line) => !line.includes(CRON_MARKER));
    this.writeCrontab([...currentLines, artifact.content]);
  }

  private removeCronLine(): boolean {
    const currentLines = this.readCrontabLines();
    const nextLines = currentLines.filter((line) => !line.includes(CRON_MARKER));
    if (nextLines.length === currentLines.length) {
      return false;
    }
    this.writeCrontab(nextLines);
    return true;
  }

  private findCronLine(): string | null {
    return this.readCrontabLines().find((line) => line.includes(CRON_MARKER)) ?? null;
  }

  private readCrontabLines(): string[] {
    const result = this.runCommand('crontab', ['-l']);
    if (result.code !== 0) {
      return [];
    }
    return result.stdout.split('\n').filter((line) => line.trim().length > 0);
  }

  private writeCrontab(lines: readonly string[]): void {
    const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';
    this.runCommand('crontab', ['-'], content);
  }

  private buildPlist(hour: number, minute: number): string {
    const outLog = path.join(this.logsDir, 'run.out.log');
    const errLog = path.join(this.logsDir, 'run.err.log');
    return `${[
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      `  <string>${LAUNCHD_LABEL}</string>`,
      '  <key>ProgramArguments</key>',
      '  <array>',
      `    <string>${xmlEscape(this.binaryPath)}</string>`,
      `    <string>${xmlEscape(this.scriptPath)}</string>`,
      '    <string>run</string>',
      '    <string>--email</string>',
      '  </array>',
      '  <key>StartCalendarInterval</key>',
      '  <dict>',
      '    <key>Hour</key>',
      `    <integer>${hour}</integer>`,
      '    <key>Minute</key>',
      `    <integer>${minute}</integer>`,
      '  </dict>',
      '  <key>RunAtLoad</key>',
      '  <false/>',
      '  <key>StandardOutPath</key>',
      `  <string>${xmlEscape(outLog)}</string>`,
      '  <key>StandardErrorPath</key>',
      `  <string>${xmlEscape(errLog)}</string>`,
      '</dict>',
      '</plist>',
    ].join('\n')}\n`;
  }

  private buildCronLine(hour: number, minute: number): string {
    const logPath = path.join(this.logsDir, 'run.log');
    return (
      `${minute} ${hour} * * * "${this.binaryPath}" "${this.scriptPath}" run --email ` +
      `>> "${logPath}" 2>&1 ${CRON_MARKER}`
    );
  }
}

function parseTime(at: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(at);
  if (!match) {
    throw new ValidationError(`Invalid schedule time "${at}"; use HH:MM.`);
  }
  const hour = Number.parseInt(match[1] ?? '', 10);
  const minute = Number.parseInt(match[2] ?? '', 10);
  if (hour > 23 || minute > 59) {
    throw new ValidationError(`Invalid schedule time "${at}"; hour must be 00-23, minute 00-59.`);
  }
  return { hour, minute };
}

function nextOccurrence(at: string, from = new Date()): Date {
  const { hour, minute } = parseTime(at);
  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function extractPlistTime(content: string): string | null {
  const hourMatch = /<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/.exec(content);
  const minuteMatch = /<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/.exec(content);
  if (!hourMatch || !minuteMatch) {
    return null;
  }
  return `${(hourMatch[1] ?? '0').padStart(2, '0')}:${(minuteMatch[1] ?? '0').padStart(2, '0')}`;
}

function extractCronTime(line: string): string | null {
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*/.exec(line);
  if (!match) {
    return null;
  }
  return `${(match[2] ?? '0').padStart(2, '0')}:${(match[1] ?? '0').padStart(2, '0')}`;
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
