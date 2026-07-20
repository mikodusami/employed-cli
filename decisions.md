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

## 2026-07-19T20:17:23-04:00 — Provider-agnostic AI configuration

Application configuration uses an `ai` block with an explicit `claude`, `codex`, or `chatgpt`
provider, defaulting to `claude`. This matches the already provider-neutral `ai_cache` table without
introducing runner interfaces, provider implementations, or provider-dependent cache keys before
their designated AI-runner layer.

## 2026-07-19T20:29:18-04:00 — Ordered AI provider fallback contract

The v2 remediation supersedes the single `ai.provider` selector with a master switch, independently
enabled Claude and Codex providers, and a unique ordered preference list. Full defaults enable both
providers and prefer Claude before Codex. Future runner behavior will skip disabled providers and
fall through enabled providers in order; an AI master switch or no enabled providers means degraded
AI-free operation. Cache keys are documented to include the provider, but no key construction or
runner implementation is introduced in this remediation.

## 2026-07-19T20:43:54-04:00 — Company registry service boundary

Company commands orchestrate injected capabilities while `CompanyService` owns URL normalization,
case-insensitive duplicate behavior, default-tier application, detection persistence, and batch
failure containment. ATS detection is an interface with a deterministic no-network stub until Layer
3. Repository lookup uses SQLite `COLLATE NOCASE`, keeping set membership in the database.

Company-file schemas validate structure but leave URL protocol validation to `CompanyService`. This
allows an import containing one non-web URL to report that company as failed while importing all
valid siblings, instead of rejecting the whole YAML file before batch rules can run.

Command context exposes capabilities as `ui`, `config`, `db`, and `repos`; services are constructed
inside commands rather than accumulated in context. Expected `AppError` subclasses render cleanly,
while unexpected errors retain stack traces as development signals.

## 2026-07-19T21:07:31-04:00 — Pure ATS matching with an injectable HTTP shell

ATS detection is split between ordered, side-effect-free signature rules and an HTTP-backed
`SignatureDetector`. All fetches use the `HttpClient` contract with a truthful user agent, redirect
capture, a 15-second default timeout, and typed transport errors. Detection converts HTTP and network
failures into diagnostic `unknown` data so company registration remains successful and health stays
`untested` until a later adapter smoke test.

The detector is a command-context capability constructed once by the CLI; company and import
commands inject it into the unchanged `CompanyService`. Normal tests use saved signature fixtures and
HTTP fakes. Current live checks are opt-in through `EMPLOYED_LIVE_ATS_TESTS=1`.

Greenhouse matching accepts both the specification's `boards.greenhouse.io` host and the current
`job-boards.greenhouse.io` host observed on Anthropic's live public board. This compatibility alias
keeps historical embeds working while handling the provider's present hosted-domain convention.

## 2026-07-19T21:40:25-04:00 — Canonical scrape source and adapter boundaries

Every ATS and future generated scraper emits `RawPosting` through `ScrapeSource`. Greenhouse and
Lever adapters validate only consumed fields with passthrough Zod schemas, reject missing required
fields with typed `AdapterError` detail, and normalize HTML descriptions without a DOM dependency.
Adapter selection remains a registry map, so services contain no provider switches.

Dedupe computation is pure domain logic: native external IDs win verbatim; otherwise a SHA-256 hash
combines normalized title and URL path. Repository uniqueness remains the enforcement boundary.
The repository bundle exposes an atomic callback so `ScrapeService` can transact across repositories
without receiving or leaking the raw SQLite driver.

`ScrapeService` contains adapter failures per company, records failure streaks, and returns structured
completed, skipped, or failed results. Detection-tail smoke tests update health only when an adapter
returns at least one valid posting. SQLite `CURRENT_TIMESTAMP` values are parsed as UTC for accurate
relative display.
