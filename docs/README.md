# employed documentation

This handbook explains how to install, configure, operate, and recover `employed`. If this is your
first time using the application, read the guides in order through Daily Operation. The remaining
guides can be used as references.

## Start here

1. [Getting started](getting-started.md) — install the CLI, initialize a workspace, add your first
   company, run a scan, and read the first report.
2. [Configuration](configuration.md) — understand every setting in `config.yaml`,
   `companies.yaml`, and `keywords.yaml`.
3. [Job discovery and scoring](job-discovery.md) — company tiers, ATS detection, generated
   scrapers, scanning, healing, score bands, and dismissing jobs.
4. [Daily operation](daily-operation.md) — `run`, reports, SMTP delivery, scheduling, logs, and
   health checks.

## Applications and insights

5. [AI providers and Gmail](ai-and-gmail.md) — Claude/Codex setup, degraded mode, Gmail MCP, and
   email synchronization.
6. [Application tracking](application-tracking.md) — apply, board, status transitions, notes, and
   the event history.
7. [Analytics and portability](analytics-and-portability.md) — statistics, JSON/CSV exports,
   backups, restores, and Job Search HQ migration.

## Reference and help

8. [Command reference](command-reference.md) — every command and option in one place.
9. [Troubleshooting](troubleshooting.md) — common installation, provider, scraper, Gmail, SMTP,
   database, scheduler, and import problems.

The repository-level [README](../README.md) is the compact product overview. This folder is the
detailed operating manual.

## Where employed stores data

The default workspace is `~/.employed`:

```text
~/.employed/
├── config.yaml       application settings
├── companies.yaml    editable company watch list
├── keywords.yaml     scoring profile
├── employed.db       SQLite source of truth
├── reports/          dated Markdown reports
└── logs/             scheduled-run output
```

Set `EMPLOYED_DIR` before running a command to use another workspace. This is especially useful for
testing; do not point it at one workspace for initialization and another for later commands.
