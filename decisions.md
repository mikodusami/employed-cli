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

## 2026-07-19T22:05:00-04:00 — Isolated state for every user flow

Every user flow that initializes or mutates Employed state runs in a new temporary `EMPLOYED_DIR`.
The flow begins by exporting a `mktemp -d` directory and calling `employed init`, then removes that
specific directory and unsets the variable on completion. This makes each flow reproducible in any
order and prevents jobs, companies, configuration edits, or health data from leaking into another
flow.

## 2026-07-19T23:34:34-04:00 — Complete Tier-1 ATS adapter fleet

The shared `HttpClient` owns both text GET and JSON POST policy so Workday does not create a private
network path. Workday composite slugs use one validated codec shared by detection and scraping.
Pagination remains inside SmartRecruiters and Workday adapters, bounded at five and twenty-five pages
respectively; the scrape pipeline continues to receive one complete canonical posting list.

SmartRecruiters and Workday intentionally store null descriptions because their list endpoints omit
full content and per-job detail requests would create unacceptable N+1 traffic. Live checks across
three boards per new provider confirmed the mappings. Ubisoft demonstrated that a SmartRecruiters
department object may omit its label, so that nested field is optional. NVIDIA confirmed Workday
public URLs require the careers-site segment before `externalPath`.

## 2026-07-19T23:54:22-04:00 — Composable HTTP robustness stack

HTTP policy is implemented as independently testable decorators over the stable `HttpClient` seam.
Retry wraps politeness, which wraps conditional caching and the raw transport. This intentionally
differs from the layer's illustrative nesting because retry must invoke politeness again for every
attempt; putting politeness outermost would let later attempts bypass its domain queue. Cache
revalidation remains inside that queue, and POST requests bypass caching.

Per-domain scheduling uses a documented final-two-host-label approximation and a global semaphore.
Detection is the only current non-API fetch, so it consults a memoized robots gate and records denied
companies as manual. Tier-1 adapter APIs remain exempt. Migration 2 owns the persistent HTTP cache,
while `--verbose` routes 304 diagnostics through the UI rather than printing inside infrastructure.
HTTP construction remains lazy so help, version, and initialization do not require existing config.

## 2026-07-20T00:42:00-04:00 — Provider-neutral AI execution boundary

Features receive only the nullable `AiRunner` contract; provider selection, subprocess execution,
fallback, output extraction, Zod validation, correction retry, budgeting, and caching stay behind
that boundary. Cache keys include provider, versioned template ID, and semantic input digest. Cache
hits are validated and free, while every real provider invocation—including the single correction
attempt—consumes the shared per-process budget.

Claude and Codex commands use argv-only subprocesses with no shell. Codex execution uses the current
CLI's JSONL mode with ephemeral, read-only, and repository-check-bypass flags, as verified against
the installed CLI and official Codex manual. Spawn-level termination escalates from `SIGTERM` to
`SIGKILL`, and the runner adds an independent deadline guard. Provider failures and timeouts advance
through configured preference order; validation and budget errors remain explicit typed outcomes.

`employed doctor` is deliberately diagnostic: it reports enabled, installed, version, and active
provider state plus SQLite path, migration version, table count, and integrity, while always exiting
successfully. AI disabled in configuration produces a nullable runner and an explicit doctor note.

The documented isolated-flow protocol exposed that `EMPLOYED_DIR` was previously a documentation-
only convention. Path constants now honor a non-empty environment override before deriving all
workspace paths, ensuring temporary user-flow workspaces are genuinely isolated from `~/.employed`.

## 2026-07-20T04:37:21-04:00 — Generated scraper trust boundary

`ScraperConfigSchema` is the single runtime and type definition shared by generation, persistence,
and execution. Generated configurations remain data: one generic static executor owns selectors,
field extraction, URL resolution, and bounded pagination. A configuration is persisted as
`generated-static` only after it executes and passes every validation-gate criterion. Two failed
extractions mark health broken while preserving the previous method and config.

Configurations requiring browser interactions are stored as `generated-playwright` intent with
their confidence and notes intact, then reported as pending instead of being misrepresented as a
working static scraper. Unit 7 will own their execution.

## 2026-07-20T04:37:21-04:00 — Stable DOM generation input

The deterministic Cheerio distiller removes executable and visual-only nodes, comments, and all
attributes except selector-relevant identity, link, ARIA, and data attributes. Its output is capped
at 35 KiB around a repeated-link subtree; singleton links are excluded from focus selection to avoid
centering prompts on navigation. The distilled bytes—not the original response—form the first-attempt
AI cache digest.

## 2026-07-20T04:37:21-04:00 — Separate structural and domain retries

The AI runner's one correction retry remains limited to malformed or schema-invalid JSON. Scraper
generation independently permits one retry when valid configuration data executes poorly. That
second task incorporates validation reasons in both its prompt and a feedback-scoped digest, which
prevents the first valid-but-bad cached configuration from defeating the domain retry while keeping
later runs cacheable.

Automatic generation after unknown-source detection defaults on through `run.autoGenerateOnAdd`.
Explicit generation remains available, and disabled or runtime-unavailable AI returns a successful
degraded outcome that leaves the company registered and unchanged.

## 2026-07-20T04:58:22-04:00 — Run-scoped rendered scraping

`ScrapeRuntime` owns one lazy `BrowserPool`, one heal budget, and the composed generation, scraping,
and company services for a command or future scheduled run. The pool is a scrape-layer dependency,
not command context state. It launches Chromium only on first rendered use, creates an isolated page
per company, blocks images, fonts, and media, and closes borrowed pages in `finally`. Commands close
the runtime in their own `finally`, including when detection, generation, or scraping throws.

Static and Playwright strategies share the same Cheerio field extractor. Playwright differs only in
DOM acquisition and interaction: navigation, next-page URLs, load-more clicks, and bounded infinite
scroll. Empty rendered pagination pages terminate without waiting for a missing selector timeout.

## 2026-07-20T04:58:22-04:00 — Rendered generation escalation

Generation counts links carrying job-like URL or text signals rather than all navigation links.
Fewer than three such links triggers a rendered recapture before distillation when Chromium is
available. AI-requested Playwright strategies and static configs requiring browser interactions are
executed through the same validation gate and persist as `generated-playwright` only after passing.

## 2026-07-20T04:58:22-04:00 — Bounded self-healing policy

`ScrapeService` is the single heal trigger. A previously working scraper's first consecutive empty
or exceptional result records failure and degrades health without attempting repair. A later failure
enters a run-scoped budget, defaults to two attempts per company and five globally, and retries the
scrape exactly once after a successful repair. Heal exceptions are contained as result notes.

ATS companies always re-run signature detection and smoke testing before generation, so migrations
can heal without AI. Generated companies require generation; when AI is disabled or unavailable they
remain degraded instead of crashing or being marked falsely repaired. Successful detection or
generation sets health to ok and resets the failure streak; exhausted or failed repair is surfaced
as deferred or broken with an explicit note.

## 2026-07-20T05:23:09-04:00 — Versioned scoring model boundary

The pure scoring engine owns structural multipliers of two for title signals, one for description
signals, and negative two for penalties, plus the A/B/C thresholds of 30/18/8. Per-keyword weights
remain exclusively in `keywords.yaml`. This separates user tuning from model-shape changes and gives
reports and future statistics one exported threshold source.

Matching is case-insensitive substring matching. Title and description lists inspect only their
respective fields, while negative signals deliberately inspect title and description together.
Matched signals are deduplicated across lists and persisted as a JSON array even though analytics do
not consume them yet. Missing or blank descriptions set the engine's `titleOnly` flag; no duplicate
database flag is stored because that state remains derivable from the job row.

## 2026-07-20T05:23:09-04:00 — Scoring persistence and offline re-scoring

`ScrapeService` scores normalized posting data before every upsert, including known-job refreshes,
then persists score, band, and matched keywords atomically with job and company updates. Repositories
store these values but never compute them. Production scrape runtimes receive one memoized keyword
profile from `ConfigService`; direct low-level tests may use an empty profile.

`employed rescore` loads the current profile once and updates only open jobs inside one transaction.
It receives no HTTP or scraper dependency, making a weight edit independently applicable without a
network request. Interactive scan output ranks newly inserted jobs by descending score and presents
Score, Band, Title, and Location in that order.

## 2026-07-20T05:35:23-04:00 — Report projection and presentation boundary

The database remains the report source of truth. `buildDailyReport` projects repository rows into
one serializable `DailyReport`; Markdown, terminal, and JSON consume that model without querying the
database. The assembler receives both report date and current time, keeping ordering, age
calculation, and rendered output reproducible. The dated Markdown file is overwritten as an export,
never read back or incrementally mutated.

The report model reserves summary, run, auto-application, and attention slots now so later units can
populate them without changing renderer contracts. Until orchestration records healed counts, that
field is explicitly zero; absent runs remain null and render as a manual report. Broken companies
already populate attention, while title-only state remains derived from the stored description.

## 2026-07-20T05:35:23-04:00 — Daily report command contract

`employed new` defaults to the current UTC date, with `--today` documenting that current contract and
leaving room for a future rolling-window option. Band selection filters the report model before every
presentation, so terminal, JSON, and the written Markdown export cannot disagree. JSON mode uses the
UI's raw-output boundary and emits exactly one serialized model with no banners or status messages;
its shape is treated as a semi-public dashboard contract.

## 2026-07-20T15:18:17-04:00 — Run orchestration reuses `ScrapeRuntime`; owns only run-scoped state

`RunService.execute` is pure orchestration: it constructs one `ScrapeRuntime` per run (the same
composition already used by `company add`, `import`, and `scan`) so the browser pool, heal budget,
and generator are wired identically everywhere, then loops over selected companies calling nothing
but prior units' services. The only state `RunService` itself owns is the run accumulator (counts,
failures), the `runs` row lifecycle, and the tier index. If a future change needs `run` to know about
scraping or scoring internals directly, that logic is misplaced and belongs in a service.

A per-company `try/catch` inside the loop converts any exception — expected `failed` results and
unexpected throws alike — into a `RunFailure` entry rather than aborting the run, satisfying "one
company's failure never aborts the loop" even for defects outside `ScrapeService`'s own containment.
Genuine run-level crashes (for example a report-write failure) are left to propagate; a `finally`
block unconditionally closes the `runs` row with whatever the accumulator holds and closes the
browser pool, so a crash still leaves an accurate, non-hanging observability record.

## 2026-07-20T15:18:17-04:00 — Tier scheduler is a pure function; run index is derived, not stored

`selectCompaniesForRun(companies, runIndex)` is a pure filter with no I/O, unit-tested directly against
run indexes 1, 2, 3, and 6 to pin the exact staggering: tier A every run; tier B every run except
`generated-playwright` companies, which run only on even indexes; tier C only when the index is a
multiple of three. `--tier` bypasses this filter entirely rather than composing with it, matching "the
override ignores the schedule" rather than intersecting with it.

The run index itself is `repositories.runs.count()` after `runs.start()` inserts the current row —
counting existing rows rather than adding a `meta` key-value table (the layer spec's other suggested
option). Every `employed run` invocation inserts exactly one row, so the count is already the correct
monotonic index with no migration and no extra table to keep in sync.

## 2026-07-20T15:18:17-04:00 — Lifecycle closure compares timestamps instead of counting misses

`markClosedIfUnseen(companyId, cutoff)` closes an open job only when its `last_seen` predates the
company's *previous* successful scrape, captured by `RunService` before calling `scrapeCompany`. A job
missing on the previous scrape still has `last_seen` equal to that scrape's timestamp (first miss, left
open); a job still missing now has a `last_seen` older than that cutoff (second consecutive miss,
closed). This reuses `jobs.last_seen` and `companies.last_success`, needing no dedicated miss counter
or extra column.

This exposed a real format inconsistency the comparison depends on: `companies.last_success` was
written with SQL `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`) while `jobs.last_seen` is a JS
`toISOString()` value (`T`-separated, millisecond precision, `Z` suffix). String comparison across
those two formats does not reliably reflect chronological order on the same calendar day.
`CompanyRepository.recordSuccess` now takes an explicit `occurredAt` (defaulting to
`new Date().toISOString()`), and `ScrapeService` passes the same `today` timestamp it uses for the job
upserts in the same transaction, so both columns share one clock and one format.

## 2026-07-20T15:18:17-04:00 — Report stats are handed to the builder, not re-read mid-close

`buildDailyReport` now accepts an optional `runStats` override. `RunService` computes its own
`RunStats` from the accumulator and passes it directly, because the authoritative `runs` row is not
updated until the `finally` block that runs after the report is written — reading `runs.latest()` at
report-build time would see the *previous* run's row, not this one. `employed new` is unaffected: it
never passes an override, so it keeps deriving stats from the persisted row exactly as before.
`RunService` also accepts an injectable `reportsDirectory`, defaulting to the real reports path, so
tests never write outside a temp directory.

## 2026-07-20T15:18:17-04:00 — Run lock is a command-level concern, not a `RunService` concern

`acquireRunLock`/`release` live in `util/lock.ts` as a plain pidfile: written at acquisition, checked
for liveness with a zero-signal `process.kill` probe, and silently reclaimed when the owning pid is
dead. The `run` command acquires the lock before constructing `RunService` and releases it in its own
`finally`, keeping `RunService` itself lock-free and fully testable in-memory — unit tests never touch
`~/.employed/run.lock`, and a stale lock left by a crashed process never permanently blocks future runs.

## 2026-07-20T15:18:17-04:00 — Scheduler installer generates before writing, and never clobbers silently

`ScheduleService` separates `buildArtifact` (pure, platform-only, no disk or OS calls) from `install`
(writes the file, then loads/updates the OS scheduler). `employed schedule install` calls
`buildArtifact` first and prints the result before `install` ever touches disk, satisfying "generated
artifact shown before writing" without requiring an interactive confirmation prompt. `install` refuses
a second installation unless `--force` is passed, rather than overwriting a running schedule outright.

Both the `launchctl`/`crontab` invocations and the binary/script path resolution
(`process.execPath` + `process.argv[1]`) are constructor-injected, mirroring the existing
`ProcessRunner`/`BrowserLauncher` seams — tests substitute a fake `CommandRunner` and temp file paths
so no test run ever touches a real launch agent or the developer's actual crontab. The Linux cron
marker comment lives on the *same* line as the scheduled command (not a separate line), since
`schedule remove`/`status` locate the managed entry by scanning for that marker.

## 2026-07-20T15:18:17-04:00 — `AiRunner.callCount()` is optional so existing test doubles stay valid

`runs.claude_calls` (the column name predates multi-provider support and is intentionally left as-is
to avoid an unrelated migration) needed a way to read the AI budget counter already tracked inside
`DefaultAiRunner`. `callCount()` was added to the `AiRunner` interface as an *optional* method precisely
so the several hand-written test doubles implementing `AiRunner` elsewhere in the suite keep compiling
unchanged; `RunService` reads it as `ai?.callCount?.() ?? 0`.

## 2026-07-20T15:18:17-04:00 — `doctor` gained a last-run diagnostic instead of a new command

Per the layer's observability note, `DoctorService` now also reads `repositories.runs.latest()` and
reports started time, duration, new-job count, and failure count — a small addition to an existing
command rather than a new one, since `doctor` already owns environment diagnostics and the `runs`
table only becomes meaningful once this unit exists.

## 2026-07-20T15:43:05-04:00 — No prototype existed to port; the classifier/extractor are original

The layer spec for the email classifier and company extractor says explicitly to port an existing,
real-inbox-validated prototype (11/11 classification, 9/9 extraction, including named cases like Red
Hat and Federal Reserve Bank of Atlanta via Workday, and Whatnot via an Ashby subject). No such
prototype exists anywhere in this repository or its history. Asked directly, the owner confirmed none
exists yet. Rather than fabricate rules and claim they came from real-inbox validation, `classify.ts`
and `extract-company.ts` are original code, structurally faithful to the spec's ordered pipeline and
two-tier extraction shape, with the three named example cases reproduced as clearly-labeled invented
fixtures (see each file's header comment) rather than as verified real data.

This must be reconciled later: if the owner's real prototype or real inbox samples surface, the rules
and fixtures here should be replaced with the validated versions, and the acceptance bar becomes real
11/11 and 9/9 rather than structurally-equivalent invented cases.

## 2026-07-20T15:43:05-04:00 — Fall-through classification is `type: null`, not a fourth confidence

The spec's own `Classification` sketch types `type` as non-nullable `EmailClass`, but its prose
requires a fall-through (no rule matched) to be distinguishable from a deliberate `ignore` and to
route to AI classification in a later unit. `type` is widened to `EmailClass | null`; a rule match
always returns a concrete type with `confidence: 'high'`, and a fall-through is exactly
`{ type: null, confidence: 'low' }`. No rule ever produces `confidence: 'low'` — that combination is
reserved for "nothing matched," keeping the confidence field a pure signal of "did a rule fire."

## 2026-07-20T15:43:05-04:00 — Two-tier extraction is ordered subject-first, not domain-gated

`extractCompany` tries subject-pattern extraction (tier 1) against every email regardless of sender,
then falls back to a sender-domain/local-part lookup table (tier 2) only if tier 1 found nothing. The
spec frames Ashby as an *example* of tier 1, not its only applicable domain, so tier 1 is written as a
general phrase-pattern matcher (covers Greenhouse, Lever, and generic ATS subjects too) rather than
gated to a hardcoded domain allowlist. Tier 2 exists specifically for platforms like Workday whose
sending domain and subject line never reveal the real company — only a per-tenant local part does —
and a miss there returns `null` rather than guessing.

Classifier and extractor remain fully independent: neither module imports the other, enforced by a
source-grep test in each suite, matching the spec's "classification doesn't depend on company,
extraction doesn't depend on type."

## 2026-07-20T16:04:31-04:00 — Gmail retrieval query is original, not ported (no prototype existed)

Same situation as Unit 1: the layer spec says to port the prototype's §5 query verbatim, but no
prototype exists. `buildGmailQuery` in `src/gmail/fetch.ts` is original: `newer_than:{days}d` plus an
OR-list of known ATS sender domains (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS,
Workable) and a generic subject fallback. Labeled as invented in the file's header comment, same as
the classifier/extractor. Reconcile with the owner's real query if one surfaces.

## 2026-07-20T16:04:31-04:00 — `AiTask.noCache` is an opt-in flag, checked at both cache read and write

`EmailFetcher` needs every call to hit Gmail fresh (a cached "yesterday's inbox" snapshot would be
actively wrong), while `AiTailClassifier` needs the opposite — the same batch of ambiguous emails
should classify identically and for free on a retry. Rather than two runner code paths, `AiTask`
gained one optional `noCache` boolean that `DefaultAiRunner.runJson` checks before reading the cache
and before writing to it. Default (`undefined`/`false`) preserves every existing task's behavior
unchanged; only `EmailFetcher` sets it to `true`.

## 2026-07-20T16:04:31-04:00 — CRM repository timestamps are always caller-supplied, never SQL-computed

Following the Layer 4 Unit 3 lesson about `CURRENT_TIMESTAMP` (SQL, space-separated) silently
diverging from `toISOString()` (JS, `T`-separated) on the same calendar day, `ApplicationRepository
.create`/`.updateStatus` and `EventRepository.append` all take an explicit timestamp parameter from
the caller instead of computing one in SQL. `SyncService` computes exactly one `nowIso` per `run()`
call and threads it through every write in that run, so an application's `created_at`, its
`last_activity_at`, and its sync event's `at` are always the identical string when they result from
the same sync pass.

`ApplicationRepository.findByCompanyRole` matches `company_name` case-insensitively and treats a
missing `role` on either side (the query or the stored row) as compatible rather than a mismatch,
since email-extracted roles are best-effort and often absent.

## 2026-07-20T16:04:31-04:00 — A proposal's action (create vs. update) follows from a DB match, not type

The spec frames sync's output as "create-application, or status-update on an existing application."
Rather than hard-coding `applied` emails to always create and every other type to always require an
existing match, `SyncService` looks up `findByCompanyRole` for every resolved email and infers the
action from whether a match exists: found → `update`, not found → `create`. This means an `interview`
or `offer` email for a company you never explicitly tracked still bootstraps a CRM record instead of
being silently dropped, which is more useful for a personal tool than requiring `apply` to have been
run first for every company. Documented here since it's an interpretation, not a literal restatement
of the spec's wording.

## 2026-07-20T16:04:31-04:00 — Cron auto-apply gate: rule-high-confidence AND an existing-application match

"High-confidence, exact-company-match status updates" is implemented as
`proposal.confidence === 'high' && proposal.action === 'update'`. Because the AI tail only ever
handles emails the rule classifier already gave up on, every AI-tail-resolved proposal is
`confidence: 'low'` by construction — so cron mode never auto-applies an AI-resolved classification,
regardless of how confident the AI sounded. This is a hard safety boundary, not a tunable threshold.
`action === 'update'` additionally excludes cron from ever auto-creating a new CRM record; bootstrapping
a record it's never seen before always waits for a human to confirm interactively.

## 2026-07-20T16:04:31-04:00 — Deferred cron proposals are ledgered but not auto-resurfaced (scope boundary)

The spec says cron mode's deferred proposals "defer to the next interactive sync" while also saying
"all fetched threads get ledgered regardless" — read literally together, these are in tension: the
ledger's `seen`-filter is exactly what prevents a thread from being fetched/considered again. This
unit resolves it narrowly: every cron-mode proposal (auto-applied or deferred) is ledgered
(`application_id` null for deferred ones, `classified_as` still recording the resolved type), so cron
never re-fetches or re-classifies the same raw email every morning. **Automatically re-surfacing a
deferred proposal in a later interactive sync is out of scope for this unit** — it would need the
ledger (or a new table) to persist enough of the proposal (company, role, type) to reconstruct it
without the original email, which isn't part of this unit's schema. Flagging this as a known gap
rather than guessing at unspecified schema; reconcile if the owner wants deferred proposals to
resurface.

## 2026-07-20T16:04:31-04:00 — Every sync-driven event is tagged `type: 'email'`

`EventType` already includes a generic `email` value distinct from `applied`/`oa`/`interview`/
`offer`/`rejected`/`note`. Every event `SyncService` appends uses `type: 'email'` with a `note`
describing the actual resolved classification (e.g. "Classified as rejected via email sync (thread
t1)."), so the event log can distinguish "this status change was auto-detected from email" from a
manually-run Unit 3 CRM command, which is expected to set a more specific event type directly.

## 2026-07-20T16:04:31-04:00 — `SyncService` never depends on `@clack/prompts`; the command injects a prompter

`ProposalPrompter` is a one-method interface (`selectProposals`); `commands/sync.ts` is the only file
that imports `@clack/prompts`, wrapping it in `ClackProposalPrompter`. `RunService`'s cron integration
passes a `NEVER_PROMPTER` stub that would throw if ever called (it never is — cron mode's own code
path never invokes the prompter). This keeps `SyncService` fully unit-testable with a "scriptable
prompt fake" exactly as the acceptance criteria describe, with no UI library or terminal interaction
anywhere in its test suite.

## 2026-07-20T16:04:31-04:00 — `run`'s Gmail hook degrades to a no-op on any failure, with a 2-day window

`RunService.syncGmail` wraps `SyncService.run('cron', ...)` in a try/catch that swallows any error
(Gmail MCP not yet configured, a malformed AI response, anything) and returns no auto-applied
updates — the same "one part's failure never aborts the run" discipline the scraping loop already
follows. The sync window is a fixed 2 days rather than a new config field: `run` fires daily, so a
2-day trailing window still covers a missed day without inventing config surface the spec didn't ask
for. `buildDailyReport` gained an `autoApplied` override (mirroring the `runStats` override from Layer
4 Unit 3) so `RunService` can hand it cron sync's results directly.
