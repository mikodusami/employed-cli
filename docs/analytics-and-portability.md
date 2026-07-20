# Analytics and portability

Employed can explain how the search is performing and move your data between workspaces or other
tools without depending on its terminal UI.

## Application analytics

```bash
employed stats
employed stats --json
```

With no applications, stats gives a useful empty-state message and JSON rates are `null`, never
`NaN`. With data, it computes:

### Headline rates

- Response rate: applications with any OA, interview, offer, or rejection event.
- Positive response rate: responses excluding a bare rejection.
- Interview rate: applications that ever recorded an interview event.
- Average days to first response: `first_response_at - applied_at` where available.

These are event scans. Later status changes do not erase earlier progress.

### Application cadence

The 12-week applications-per-week series is rendered as a Unicode sparkline scaled to its largest
bucket. JSON includes both buckets and chart text.

### Outcome breakdowns

- Score band × outcome checks whether high-scoring jobs convert better. Manual/job-less
  applications are reported separately because they have no band.
- Résumé version × outcome compares your free-form résumé labels. Groups below
  `stats.minResumeSample` are marked low-signal.
- Keyword → response correlation expands stored `matched_kw` values and shows only keywords meeting
  `stats.minKeywordSample`. Treat this as directional, not causal.

### Nudges and stale applications

Active applications quiet for `stats.followUpDays` appear as follow-up candidates. At
`stats.staleDays`, they appear in the stale section. Offers and rejections are excluded.

Keep transitions and notes current so `last_activity_at` reflects reality.

## Versioned JSON backup

Print a complete snapshot:

```bash
employed export --json
```

Write it to disk:

```bash
employed export --out employed-backup.json
```

Version 1 contains `version`, `exportedAt`, and complete arrays for companies, all job states,
applications, and events. IDs are preserved so relationships can be restored exactly.

Restore into a fresh initialized workspace:

```bash
export EMPLOYED_DIR="/path/to/fresh-workspace"
employed init
employed import-hq employed-backup.json --dry-run
employed import-hq employed-backup.json
```

Equivalent rows are skipped on rerun. Conflicting local identities are rejected rather than silently
rewired. Always dry-run before importing into a workspace that already has data.

## CSV exports

Applications:

```bash
employed export --csv --kind applications --out applications.csv
```

Jobs:

```bash
employed export --csv --kind jobs --out jobs.csv
```

CSV includes stable headers and quotes commas, quotes, and newlines correctly. Application fields
include current status, résumé, notes, and response/activity timestamps. Job fields include company
ID, title, URL, location, score, band, lifecycle status, dates, and matched keywords.

CSV is for spreadsheets and downstream analysis; JSON is the lossless backup format.

## Job Search HQ migration

```bash
employed import-hq job-search-hq.json --dry-run
employed import-hq job-search-hq.json
```

The lenient importer recognizes:

- `apps[]` application records using common camelCase or snake_case fields
- `scoring.title`, `scoring.description`/`desc`, and `scoring.negative`
- `seen[]` thread ID strings or objects

Safety behavior:

- Company + role matches skip existing applications.
- Repeated records in one file are deduplicated.
- Existing email-thread ledger entries are skipped.
- Existing local keyword weights are never overwritten; missing keys are added.
- Imported applications receive an `applied` event and, when needed, a current-status event.
- Synthesized event notes contain `Imported` for audit visibility.
- Malformed input is validated before writes.
- Database changes are transactional.

The summary reports companies/jobs (for native snapshots), application created/merged/skipped
counts, email threads, events, and scoring keys.

## A practical backup routine

Before configuration experiments or upgrades:

```bash
backup="$HOME/employed-backup-$(date +%F).json"
employed export --out "$backup"
```

The snapshot covers SQLite core history. Also copy `config.yaml`, `companies.yaml`, and
`keywords.yaml` if you want an exact workspace/configuration backup, because native JSON intentionally
contains operational data rather than credentials and all editable settings.
