/** Verifies generated launchd/cron artifacts, install/remove/status, and clobber refusal. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ScheduleService, UnsupportedPlatformError } from '../src/services/schedule.js';
import { ValidationError } from '../src/util/errors.js';

test('macOS artifact is a plist with an absolute binary path and the requested time', () => {
  const service = new ScheduleService({
    platform: 'darwin',
    binaryPath: '/usr/local/bin/node',
    scriptPath: '/usr/local/lib/employed/dist/cli.js',
    plistPath: tempPlistPath(),
    logsDir: mkdtempSync(path.join(tmpdir(), 'employed-logs-')),
  });

  const artifact = service.buildArtifact('07:30');
  assert.match(artifact.content, /<key>Hour<\/key>\s*<integer>7<\/integer>/);
  assert.match(artifact.content, /<key>Minute<\/key>\s*<integer>30<\/integer>/);
  assert.match(artifact.content, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(artifact.content, /<string>\/usr\/local\/lib\/employed\/dist\/cli\.js<\/string>/);
  assert.match(artifact.content, /<key>RunAtLoad<\/key>\s*<false\/>/);
});

test('Linux artifact is a single crontab line with an absolute binary path', () => {
  const service = new ScheduleService({
    platform: 'linux',
    binaryPath: '/usr/bin/node',
    scriptPath: '/opt/employed/dist/cli.js',
    logsDir: '/home/user/.employed/logs',
  });

  const artifact = service.buildArtifact('07:30');
  assert.equal(
    artifact.content,
    '30 7 * * * "/usr/bin/node" "/opt/employed/dist/cli.js" run --email ' +
      '>> "/home/user/.employed/logs/run.log" 2>&1 ' +
      '# employed-daily (managed by `employed schedule`)',
  );
});

test('an unsupported platform is rejected before anything is generated', () => {
  const service = new ScheduleService({ platform: 'win32' });
  assert.throws(() => service.buildArtifact('07:00'), UnsupportedPlatformError);
});

test('an invalid time is rejected', () => {
  const service = new ScheduleService({ platform: 'darwin' });
  assert.throws(() => service.buildArtifact('7:30'), ValidationError);
  assert.throws(() => service.buildArtifact('25:00'), ValidationError);
});

test('macOS install writes the plist, loads it, and status reports it', () => {
  const plistPath = tempPlistPath();
  const logsDir = mkdtempSync(path.join(tmpdir(), 'employed-logs-'));
  const calls: Array<{ binary: string; args: readonly string[] }> = [];
  const service = new ScheduleService({
    platform: 'darwin',
    plistPath,
    logsDir,
    runCommand: (binary, args) => {
      calls.push({ binary, args });
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const artifact = service.install('07:00');
  assert.ok(existsSync(plistPath));
  assert.equal(readFileSync(plistPath, 'utf8'), artifact.content);
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ['unload', 'load'],
  );

  const status = service.status();
  assert.equal(status.installed, true);
  assert.equal(status.time, '07:00');
});

test('macOS install refuses to clobber an existing schedule without --force', () => {
  const plistPath = tempPlistPath();
  const service = new ScheduleService({
    platform: 'darwin',
    plistPath,
    logsDir: mkdtempSync(path.join(tmpdir(), 'employed-logs-')),
    runCommand: () => ({ code: 0, stdout: '', stderr: '' }),
  });

  service.install('07:00');
  assert.throws(() => service.install('08:00'), ValidationError);
  assert.doesNotThrow(() => service.install('08:00', true));
  assert.equal(service.status().time, '08:00');
});

test('macOS remove unloads and deletes the plist, and reports nothing installed after', () => {
  const plistPath = tempPlistPath();
  const calls: string[] = [];
  const service = new ScheduleService({
    platform: 'darwin',
    plistPath,
    logsDir: mkdtempSync(path.join(tmpdir(), 'employed-logs-')),
    runCommand: (binary, args) => {
      calls.push(args[0] ?? '');
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  service.install('07:00');

  const removed = service.remove();
  assert.equal(removed, true);
  assert.equal(existsSync(plistPath), false);
  assert.equal(service.status().installed, false);
  assert.equal(service.remove(), false);
});

test('Linux install upserts one managed crontab line without disturbing other lines', () => {
  let crontab = '0 9 * * * /usr/bin/some-other-job\n';
  const service = new ScheduleService({
    platform: 'linux',
    logsDir: mkdtempSync(path.join(tmpdir(), 'employed-logs-')),
    runCommand: (binary, args, input) => {
      if (binary !== 'crontab') {
        throw new Error(`unexpected binary ${binary}`);
      }
      if (args[0] === '-l') {
        return { code: 0, stdout: crontab, stderr: '' };
      }
      crontab = input ?? '';
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  service.install('07:00');
  assert.match(crontab, /some-other-job/);
  assert.match(crontab, /employed-daily/);
  const status = service.status();
  assert.equal(status.installed, true);
  assert.equal(status.time, '07:00');

  const removed = service.remove();
  assert.equal(removed, true);
  assert.match(crontab, /some-other-job/);
  assert.doesNotMatch(crontab, /employed-daily/);
  assert.equal(service.status().installed, false);
});

function tempPlistPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'employed-schedule-')), 'agent.plist');
}
