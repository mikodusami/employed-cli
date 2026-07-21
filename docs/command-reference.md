# Command reference

Use `employed COMMAND --help` for the installed version's authoritative syntax.

## Global options

```text
-V, --version       print the version
--no-animation      disable animated/color-rich TTY output
--verbose           show HTTP cache diagnostics
-h, --help          show help
```

## Workspace and diagnostics

### `employed init`

Creates missing workspace directories/configuration, validates all YAML, and migrates SQLite.
Safe to rerun; existing files are preserved.

### `employed doctor [--strict]`

Displays AI, Gmail MCP, SMTP, scraper fleet, database, last-run, and scheduler health. Normal mode
exits zero even with issues. `--strict` exits nonzero when a red problem exists.

## Company management and discovery

### `employed company add <name> --url <url> [--tier A|B|C]`

Registers a careers page, detects a supported ATS, smoke-tests it, and optionally generates a
custom scraper. Duplicate names are skipped.

### `employed company list`

Lists tier, method, health, yield, and last success for registered companies.

### `employed company generate <name>`

Explicitly generates, executes, validates, and persists a scraper configuration for a custom page.

### `employed import [file]`

Imports company entries from YAML. Omit `file` to use the configured default company file.

### `employed scan [--company <name>]`

Scrapes a registered company, normalizes/deduplicates postings, scores them, applies the
`hardExclude`/`locations` filter, and displays new jobs. The success line reports an auto-filtered
count split by cause, e.g. `18 seen, 14 new, 4 (4 keyword, 0 location) auto-filtered`.

### `employed rescore`

Recomputes every open job using the current `keywords.yaml`; performs no HTTP or AI work. Reports
how many jobs' bands moved up or down as a result.

### `employed dismiss <jobId>`

Marks one discovered job dismissed so future reports exclude it. Distinct from an auto-filter (see
`restore` below): this is your own manual decision and cannot be undone with `restore`.

### `employed restore <jobId>`

Reopens one job that the `hardExclude`/`locations` gate auto-filtered, clearing its filter reason.
Refuses cleanly on a job that was never filtered, or was dismissed manually with `employed dismiss`.

## Runs and reports

### `employed run [--email] [--no-ai] [--tier A,B]`

Executes the full daily orchestration. `--email` forces SMTP delivery, `--no-ai` disables AI and
Gmail work for that run, and `--tier` bypasses normal tier scheduling. The terminal digest includes
an auto-filtered count alongside seen/new/closed.

### `employed new [--band A,B] [--today] [--json] [--show-filtered]`

Builds today's report, writes its dated Markdown file, and renders terminal or JSON output. Band
filtering applies to all output formats. `--today` documents the current default behavior.
`--show-filtered` additionally lists today's auto-filtered jobs with their reason, for review or
tuning; the default view omits them.

## Scheduling

### `employed schedule install [--at HH:MM] [--force]`

Installs a launchd job on macOS or crontab entry on Linux. Time defaults to `config.run.time`.
`--force` intentionally replaces the employed-managed schedule.

### `employed schedule status`

Displays installed state, configured time, artifact path, and next run.

### `employed schedule remove`

Unloads/removes only the employed-managed schedule.

## Gmail and application CRM

### `employed sync [--days N]`

Retrieves Gmail metadata through the active provider's MCP server, classifies unseen threads, shows
interactive proposals, applies selected CRM changes, and ledgers processed threads. Default: 30 days.

### `employed apply <jobId> [--resume <label>]`

Promotes a scraped job into a linked application and initial applied event. Idempotent per job.

### `employed board [--all]`

Shows pipeline columns. Rejections are summarized unless `--all` is supplied.

### `employed app <id>`

Shows one application's fields and chronological event history.

### `employed note <id> <text>`

Appends a note event and touches activity without changing status.

### `employed move <id> <status>`

Transitions an application. Status is one of `saved`, `applied`, `oa`, `interview`, `offer`, or
`rejected`. Unusual transitions warn but still succeed.

## Analytics

### `employed stats [--json]`

Computes response/interview rates, response time, weekly cadence, band/résumé/keyword outcomes, and
follow-up/stale lists. JSON emits only the serializable stats model.

## Export and import

### `employed export [--json|--csv] [--kind applications|jobs] [--out <file>]`

Defaults to JSON on stdout. `--csv` defaults to applications unless `--kind jobs` is used. `--out`
writes the exact output to a file. Do not combine `--json` and `--csv`.

### `employed import-hq <backup.json> [--dry-run]`

Imports a legacy Job Search HQ backup or version-1 native employed snapshot. Dry-run performs the
same planning and validation without writing.

## Exit and output behavior

- Expected validation/configuration failures print concise messages and exit nonzero.
- Per-company run failures are recorded but do not fail the whole run.
- `doctor` exits zero unless `--strict` finds a red problem.
- JSON modes write only JSON to stdout.
- Non-TTY, CI, and `--no-animation` output is plain and log-safe.
