# Daily operation

`employed run` is the main automation entry point. It performs scheduled discovery, scoring,
lifecycle maintenance, optional Gmail synchronization, report writing, and optional SMTP delivery.

## Running manually

```bash
employed run
```

Useful variants:

```bash
employed run --no-ai       # deterministic scraping/reporting only
employed run --tier A      # bypass schedule and run only Tier A
employed run --tier A,B
employed run --email       # force an email attempt even when email.enabled is false
```

Only one run can execute at a time. A pidfile prevents overlap and reclaims a stale lock when the
recorded process no longer exists. Each run creates a `runs` row before work and finishes it in a
`finally` path, making crashes and incomplete executions visible to `doctor`.

A failure for one company becomes a recorded failure and does not abort other companies.

## Reading today's jobs

```bash
employed new
employed new --today
employed new --band A
employed new --band A,B
employed new --json
```

The command builds a fresh projection from SQLite and always overwrites that date's Markdown export
cleanly. Band filtering occurs on the shared report model, so terminal, JSON, and Markdown agree.

The report contains:

- optional summary text when a future/available summary producer supplies it
- run statistics or a manual-report notice
- new open jobs grouped A through D and sorted by score
- title-only markers where descriptions were unavailable
- auto-applied Gmail updates
- broken scrapers and other attention items

Reports live at `~/.employed/reports/YYYY-MM-DD.md`.

## SMTP delivery

Configure the email block described in [Configuration](configuration.md), then export an app
password:

```bash
export EMPLOYED_SMTP_PASSWORD="your-app-password"
employed doctor
employed run --email
```

The email is a multipart HTML/plaintext rendering of the same report model. Its subject includes the
number of new roles, A-band count, and date. Delivery happens only after the Markdown file exists.
If SMTP fails, the run completes and prints the durable report path plus the error.

Scheduled processes must receive `EMPLOYED_SMTP_PASSWORD` in their environment. If that is difficult
on your OS, leave SMTP disabled and use the local report until the environment is configured.

## Installing the daily schedule

Use the default `config.run.time`:

```bash
employed schedule install
```

Or choose a time:

```bash
employed schedule install --at 07:00
employed schedule status
```

Use `--force` only when intentionally replacing an installed employed schedule. Remove it with:

```bash
employed schedule remove
```

macOS uses a launchd plist under `~/Library/LaunchAgents`; a sleeping laptop runs a missed launchd
job after waking. Linux uses a marked crontab line. Both invoke `employed run --email` and write
output under `~/.employed/logs`.

## Diagnosing the system

```bash
employed doctor
```

Doctor is read-only and reports:

- enabled/installed AI providers and the active preference
- Gmail MCP configuration presence
- SMTP enabled/reachable state
- company counts by health plus broken/degraded/low-confidence details
- SQLite path, schema version, table count, and integrity
- last run time, duration, new jobs, failures, and incomplete status
- scheduler installation and next fire time

Every red problem includes a suggested corrective action. Warnings and problems normally exit zero
because doctor is interactive diagnostics. For scripts or CI:

```bash
employed doctor --strict
```

Strict mode exits nonzero when a red problem exists.

## Logs and unattended behavior

- Plain output is selected automatically for non-TTY output and CI.
- `--no-animation` explicitly disables the wordmark, color, and animation.
- `--verbose` prints HTTP cache-hit diagnostics.
- Gmail sync, AI unavailability, email failure, healing failure, and individual company failures all
  degrade without losing the local report.
- Use `employed export --out backup.json` periodically to back up the SQLite-owned state.
