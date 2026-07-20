## 2026-07-19T19:33:09-04:00 — Layer 1 CLI foundation

The CLI targets Node.js 20 or newer with ESM and TypeScript `NodeNext`. All terminal output is
routed through a `UI` interface. Animated output is selected only for interactive TTY sessions;
`--no-animation`, CI, and redirected output use deterministic plain text. Application filesystem
paths and version metadata are centralized, and command modules share a registration contract.

The `lint` script initially runs TypeScript's strict no-emit validation. This keeps the first unit's
dependency set within the layer specification while enforcing type safety; a dedicated formatter or
lint engine can be added in a later tooling layer.

## 2026-07-19T19:33:52-04:00 — Layer acceptance flows

Each completed layer or unit will append reproducible, user-facing checks to `userflows.md`. These
flows use both the compiled entry point and the development runner so release and local behavior are
verified independently.

## 2026-07-19T19:59:12-04:00 — Layer 2 configuration ownership

Zod schemas are the sole source of configuration defaults and inferred types. `ConfigService`
owns YAML reading, validation, actionable errors, and per-process memoization; `ScaffoldService`
owns non-destructive filesystem creation. The `init` command only orchestrates these services
through an injected `CommandContext`.

The referenced §7.6 keyword seed profile was not present in the repository. The initial template
therefore uses a conservative software-engineering starter profile and remains user-editable. It
must be reconciled if the authoritative §7.6 values are added later.

## 2026-07-19T19:59:12-04:00 — Layer 2 persistence boundaries

SQLite uses forward-only, transactional `user_version` migrations. SQL is confined to migration
and repository modules; repositories enforce persistence constraints, while cross-repository
transactions remain available to services through `withTransaction`. The CLI lazily owns one
connection per process and injects that connection plus its repository bundle into command context,
so informational commands do not create user data as a side effect.

The referenced §6 schema was also absent. Migration 1 implements the seven named tables and every
column implied by Layer 2, with `ai_cache` replacing `claude_cache` as directed. This inferred schema
must be compared with §6 if that source is later supplied.

## 2026-07-19T20:06:02-04:00 — Authoritative Layer 2 schema reconciliation

The supplied §6, §7.1, and §7.2 sections supersede the inferred migration-1 schema and domain
unions. Migration 1 now follows §6's columns verbatim except for the directed `claude_cache` to
`ai_cache` rename, and the company/job repositories use those exact names. Scrape methods now cover
all specified ATS and generated-scraper variants; health, application status, event type, and score
band unions now match the source document.

No version-2 compatibility migration is added because this is a correction to the not-yet-settled
initial migration. A database created from the earlier inferred schema must be backed up and
reinitialized. Fresh and idempotently reopened databases remain at `user_version = 1` as required.

The attachment does not include §7.6, so the provisional keyword seed profile remains unchanged.

## 2026-07-19T20:10:18-04:00 — Authoritative scoring seed profile

The supplied §7.6 values replace the provisional `keywords.yaml` template exactly. Negative keyword
weights remain positive magnitudes because the scoring formula applies the negative multiplier;
storing negative numbers would invert the penalty. Layer 2 owns only the validated configuration
seed. Case-insensitive matching, scoring math, matched-keyword persistence, and score commands remain
work for the later scoring-engine layer.
