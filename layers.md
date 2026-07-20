## Layer 6, Unit 2: Email Digest Delivery (SMTP) + `employed doctor` Completion

**What this is:** Two loose ends that make the daily loop reach your inbox and make the whole system self-diagnosable. Email delivery fills the reserved `--email` hook from Layer 4 Unit 3 — the report already exists as markdown, this just _delivers_ it. Doctor completion pulls every health signal the prior units have been recording into one diagnostic view — the answer to "is everything wired up and working," especially for someone who just cloned the repo.

The discipline: email is a **delivery mechanism for an existing artifact**, not a new report — it renders the same `DailyReport` model (Layer 4 Unit 2's third renderer, finally). Doctor is **read-only aggregation** — it reports state the system already tracks; it diagnoses, never fixes, never fails a run.

---

**Deliverables:**

**New dependency:** `nodemailer`.

**`src/report/render/email.ts` — the third renderer:**

`renderEmailHtml(report): string` and `renderEmailText(report): string` — the same `DailyReport` model → an HTML email body (simple, inline-styled, email-client-safe: tables not flexbox, no external CSS) and a plaintext alternative. Band grouping, job links, needs-attention, the optional AI summary if present. This is why the report was built as a model with separate renderers three layers ago — email is additive, not a rewrite. Keep the HTML deliberately plain; fancy email templating is a rabbit hole and job digests want scannability over polish.

**`src/services/email.ts` — `EmailService`:**

```typescript
async sendDigest(report: DailyReport): Promise<void>;
async verify(): Promise<EmailStatus>;   // SMTP connection check for doctor
```

nodemailer transport built from config: SMTP host/port/user + app password. Sends multipart (HTML + text alternative), subject like `employed — 7 new roles (2 A-band) — 2026-07-20`. The subject line carries the signal so it's useful even unopened. On send failure: throw a typed `EmailError` — but the **caller in `run` catches it and degrades** (the report file already exists on disk; a failed email must never fail the run or lose data — §7.9 "email is additive, report file is unconditional"). `verify()` does a transport `.verify()` for doctor without sending.

**Config additions — extend the `email:` block (schema, additive):**

```yaml
email:
  enabled: false
  to: "" # recipient
  from: "" # usually same as smtp.user
  smtp:
    host: smtp.gmail.com
    port: 465
    user: "" # gmail address
    # password NOT here in plaintext template — see below
```

**Credential handling (the security note that matters):** the SMTP app password is the _one_ credential `employed` itself holds (§13). Options, document the recommended one in README: (a) `EMPLOYED_SMTP_PASSWORD` environment variable — read at send time, never written to config, **preferred**; (b) a `password` field in `config.yaml` with an enforced `chmod 600` and a loud README warning. The schema supports both (env var wins if both present); the template ships with the env-var approach commented as recommended and the plaintext field commented out. This is a local single-user tool, so this is appropriately boring — but a Gmail app password in a world-readable file is the one foot-gun to guard against, so make the env-var path the path of least resistance.

**`run` + `run.ts` wiring:** the reserved email hook activates — `config.email.enabled || --email` → after `writeReport`, `EmailService.sendDigest(report)`, wrapped so failure logs a report-line and continues. The morning run now lands in your inbox.

**`employed doctor` — completed (extend the Layer 3 Unit 5 slice):**

Pull every health signal into one command, sectioned:

- **AI providers** (already built) — per provider: installed, version, enabled, active-by-preference.
- **Gmail MCP** — probe whether the active provider can reach the Gmail tool. This is the cloner's "is my email wired up" check. For Claude: check the MCP is registered; for Codex: check `config.toml` has the server. A light probe (or a documented "run this to test" hint if a live probe is too heavy) — actionable either way: if broken, print the exact setup command (`claude mcp add gmail ...` / the Codex `config.toml` snippet).
- **Email/SMTP** — if enabled, `EmailService.verify()`; report reachable or the connection error. If disabled, say so (not an error).
- **Company fleet health** — the section that's been accumulating since Layer 2: count by health status (ok/degraded/broken/untested), then list the `broken` and `degraded` companies by name with last-success age and consecutive-failure count. This is the "which scrapers need attention" view. Low-`confidence` generated configs surfaced here too (the signal stored-but-unused since Layer 3 Unit 6 — now it has a reader).
- **Database** (already built) — path, `user_version`, integrity_check, table presence.
- **Last run** (from Layer 4 Unit 3) — when, duration, new jobs, failures; a `started_at` with null `finished_at` flagged as a crashed/incomplete run.
- **Scheduler** — whether a launchd/cron entry is installed and next fire time (reads the schedule service's `status`).

Each section: green check / amber warn / red problem, and **every problem line carries the fix** — doctor's job is to turn "something's wrong" into "run this to fix it." Exit 0 always (diagnostics don't fail builds); consider `--strict` exiting nonzero if any red, for CI-style use.

**Architectural notes:**

- **Email renders the existing model** — if you find yourself querying the DB inside the email renderer, stop; enrich the `DailyReport` model instead. Renderers stay pure `(model) → output`.
- **Doctor never mutates.** It's a pure aggregation of recorded state — health columns, run rows, config, binary probes. If doctor starts "fixing" things, that's a different command (`heal`, `generate`, `schedule install`). Keep it diagnostic.
- **Every doctor problem is actionable.** The value isn't the red X, it's the fix command next to it. This is the difference between a status page and a support tool — and it's what makes the repo cloneable by someone who isn't you.
- The SMTP password is the system's only self-held secret — the env-var-preferred design keeps the credential surface minimal, consistent with the delegation architecture that keeps Google creds out entirely.

**Acceptance criteria:**

- `renderEmailHtml`/`renderEmailText` produce valid bodies from a seeded `DailyReport`; empty sections omitted; renders with no DB access (pure).
- `EmailService.sendDigest` against a mock transport sends multipart with the signal-carrying subject; a transport failure throws `EmailError`.
- `run --email` with a failing transport: report file still written, run completes, failure surfaced as a report/log line (email failure never aborts run — asserted).
- Env-var password path works and takes precedence; with neither env var nor config password, email-enabled config fails validation with a clear "set EMPLOYED_SMTP_PASSWORD" message.
- `doctor` renders all sections on a seeded system; a broken-scraper company appears by name with fix guidance; a crashed run row (null `finished_at`) is flagged; AI/Gmail/SMTP problems each print their specific fix command.
- `doctor` exits 0 with warnings present; `--strict` exits nonzero when a red problem exists.
- `doctor` performs no writes (assert read-only) and no scraping.
- Suite offline; SMTP mocked, provider probes faked.

---

Say **next** for the final unit — Layer 6, Unit 3: `export` / `import-hq` (§15), README with the full setup walkthrough, and the banner/animation polish pass.

## Layer 6, Unit 1: `employed stats` (§7.8) — Analytics, Sparkline, Nudges

**What this is:** The "what is actually working" command — every metric computed straight from SQL over the applications and events the CRM and sync have been accumulating. This is where the append-only event log (Unit 3's discipline) pays off: interview rate is an _event-scan_, not a current-status count, so a candidate who reached "interview" then got rejected still counts as having interviewed. Pure computation over stored data, zero AI, zero network.

The discipline: **analytics read the event log, not just current status.** Current status is a lossy projection (it only shows where things _ended up_); the event history shows everything that _happened_. Any metric that only looks at `applications.status` will undercount. Compute from events wherever the metric is about "did X ever occur."

---

**Deliverables:**

**`src/services/stats.ts` — `StatsService.compute(now): StatsReport`:**

A pure assembler over the repositories, returning a fully-structured `StatsReport` (data model, like the daily report — so it renders to terminal now and JSON/other later). Each metric, per §7.8:

- **Response rate** — applications with any post-`applied` event (`oa`|`interview`|`offer`|`rejected`) ÷ total applications. Event-scan: an application that got a rejection _responded_, even though "rejected" feels negative — a response is any signal back. (Consider surfacing "positive response rate" separately: responses excluding rejection ÷ total — arguably the more useful number. Compute both, label clearly.)
- **Interview rate** — applications with an `interview` event ever ÷ total. Event-scan, explicitly — not `status = 'interview'` (which would miss everyone who advanced past or got rejected after interviewing).
- **Avg days-to-first-response** — mean of `first_response_at − applied_at` across applications that got a response. (The `first_response_at` field, set by `transition` in Unit 3, makes this a direct read rather than an event-diff — the earlier discipline paying off.)
- **Apps per week** — 12-week bucketed counts, rendered as a **sparkline** (unicode block chars `▁▂▃▄▅▆▇█` scaled to the max bucket — a tiny pure helper in `src/util/sparkline.ts`). Shows application cadence at a glance.
- **Outcomes by score band** — for applications linked to scraped jobs (which carry a band), cross-tabulate band × outcome. Answers "are my A-band applications actually converting better?" — validates the scoring model itself. Applications with no linked job (manual/Gmail) are excluded from this table with a footnote count.
- **Outcomes by résumé version** — group by `resume_version`, show response/interview rate per label. Answers "is backend-v2 outperforming generalist-v1?" Min-sample guard: label groups with <N apps flagged as low-signal, not hidden.
- **Keyword → response correlation** — join `jobs.matched_kw` (the array stored since Layer 4 Unit 1) against application outcomes: for each keyword, response rate among applications to jobs where it fired. **Min 2 apps per keyword** (§7.8) or it's noise — enforce the floor. This is the highest-value, most-speculative metric: it hints at which signals in a posting predict a response. Label it as directional, not causal.
- **Follow-up nudges** — applications quiet ≥ `followUpDays` (config, default e.g. 7) since `last_activity_at`, still in an active status (not rejected/offer) — surfaced as "consider following up."
- **Stale flags** — applications quiet ≥ `staleDays` (config, larger, e.g. 21) — "probably dead, consider closing."

**`src/services/stats-queries.ts` — the SQL layer:**

Keep the actual queries in dedicated, named, commented functions on the repositories (or a stats-query module) — not inline strings in the service. Each metric = one well-named query returning typed rows; the service composes them into the report. This keeps SQL testable in isolation and the service readable as "here are the metrics," not a wall of SQL. Event-scan metrics use `EXISTS (SELECT 1 FROM events WHERE ... type = ...)` subqueries — correct and index-friendly.

**`src/report/render/stats-terminal.ts`:**

Renders `StatsReport` to the terminal via the UI abstraction: headline rates up top, the sparkline, then the cross-tab tables (band×outcome, résumé×outcome, keyword correlation), then the nudges and stale lists as actionable sections. Color: good rates green, concerning stale counts amber. Plain fallback automatic.

**`src/commands/stats.ts` — `employed stats [--json]`:**

Build → render. `--json` emits the `StatsReport` (same data-model-is-source-of-truth pattern — feeds the HQ dashboard, §15). Empty-data grace: with zero applications, render an encouraging "no applications tracked yet — `apply` or `sync` to start" rather than a wall of zeros and NaNs. Guard every division against zero explicitly (no `0/0` rendering as `NaN%`).

**Config additions (additive):** `stats.followUpDays: 7`, `stats.staleDays: 21`, `stats.minKeywordSample: 2`, `stats.minResumeSample: 3`.

**Architectural notes:**

- **Event-scan over status-count** is the correctness spine of this unit. Write a comment on each event-scan metric explaining _why_ it's not a status count, so a future reader doesn't "simplify" it into a bug.
- Divide-by-zero and small-sample handling isn't polish — it's correctness. A response rate of "3 interviews from 4 apps = 75%" is meaningless signal; the min-sample floors and low-signal flags keep `stats` from lying with confidence. Enforce them in the _service_, so every renderer inherits the honesty.
- `stats` is **read-only** — it computes and displays, never writes. No status inference, no auto-nudging-by-email here (that could be a future extension); it surfaces what's true and lets you act.
- Reuse: `StatsReport` is a data model like `DailyReport` — same three-renderer discipline available if email/HTML views are wanted later. Build the model cleanly; don't couple it to the terminal.

**Acceptance criteria:**

- Seeded `:memory:` DB with a known application/event history: response rate, interview rate, and avg-days-to-response match hand-computed expected values — including a case where an app reached interview _then_ rejected still counts toward interview rate (event-scan proven).
- `first_response_at`-based avg matches an independent event-diff computation.
- Sparkline helper: 12 buckets scale correctly to block chars; all-zero input renders flat, single-spike renders correctly.
- Band×outcome and résumé×outcome cross-tabs are correct; manual (job-less) applications excluded from band table with the right footnote count; low-sample résumé groups flagged.
- Keyword correlation respects the min-2-apps floor (a keyword with 1 app doesn't appear); computed off `matched_kw`.
- Nudge/stale lists select the right applications by age thresholds and exclude terminal statuses.
- Zero-data and small-sample cases render gracefully — no NaN, no divide-by-zero, encouraging empty state.
- `--json` round-trips to `StatsReport`.
- Suite offline; `stats` issues zero HTTP/AI calls (assert).

---

Say **next** for Layer 6, Unit 2: email digest delivery (SMTP) + completing `employed doctor` (the fleet-health section).

## Layer 5, Unit 3: CRM Commands — `apply`, `board`, `app`, `note`, `move`, `dismiss`

**What this is:** The human-facing application tracker (§7.8's CRM half). Sync (Unit 2) already writes applications and events automatically; this unit gives _you_ direct control — promoting scraped jobs into applications, viewing the pipeline as a board, and managing status by hand. It completes the application/event repositories (sync built only the slices it needed) and establishes the status-transition rules in one place. Analytics (`stats`) is the next layer — this is the data-management surface it will read from.

The discipline: every state change is an **event append** (§5 append-only audit) — the current `applications.status` is a cache of "the latest event," and the `events` log is the truth. This is what makes `stats`'s interview-rate computation (event-scan, not current-status) possible later. Never mutate status without logging the event; enforce it by routing all transitions through one service method.

---

**Deliverables:**

**`src/db/repositories/applications.ts` + `events.ts` — completed:**

Extend beyond sync's slice: `ApplicationRepository` gains `findById`, `list(filter?)`, `listByStatus`, `updateResumeVersion`, `updateNotes`, `touchActivity` (bumps `last_activity_at`), `setFirstResponse` (sets `first_response_at` on first non-applied event). `EventRepository` gains `listForApplication(id)` ordered by `at`. These are the reads `board`, `app`, and `stats` consume.

**`src/services/application.ts` — `ApplicationService` (the transition authority):**

```typescript
async createFromJob(jobId: number, opts: { resumeVersion?: string }): Promise<Application>;
async createManual(input: { company: string; role?: string; status?: AppStatus }): Promise<Application>;
async transition(id: number, to: AppStatus, opts: { note?: string }): Promise<Application>;
async addNote(id: number, text: string): Promise<void>;
list(filter?: AppFilter): ApplicationRow[];
detail(id: number): ApplicationDetail;   // application + full event history
```

`transition` is the **single chokepoint** for status change — used by `move`, by sync (refactor Unit 2's direct writes to call this), and by `apply`. It: validates the transition (a small allowed-transitions map — e.g. can't go `rejected → oa`; but keep it permissive with a warning rather than hard-blocking, since real job searches are messy and a recruiter _can_ revive a dead thread — log unusual transitions, don't forbid them), updates `applications.status`, appends the matching `events` row, calls `setFirstResponse`/`touchActivity` as appropriate. This consolidation is why sync's transitions and manual transitions produce identical, auditable history.

`createFromJob`: pulls the job (title→role, company via job's company), creates the application linked by `job_id`, appends the initial `applied` event, records `resume_version`. `createManual`: for applications with no scraped job (Gmail-discovered, or roles you applied to off-platform) — `job_id` null, `company_name` denormalized (the schema already supports this dual origin).

**`src/commands/apply.ts` — `employed apply <jobId> [--resume <label>]`:**

Promotes a scraped job into a tracked application via `createFromJob`. Guards: job exists, not already applied (idempotent — re-applying shows the existing application rather than duplicating). Confirms with the job title + company. `--resume backend-v2` tags the résumé version (this feeds `stats`'s per-résumé outcome analysis — the label is free-form but consistency matters; consider surfacing previously-used labels as hints).

**`src/commands/board.ts` — `employed board`:**

The pipeline view: columns **Applied / OA / Interview / Offer / Rejected** rendered as terminal tables (via the UI abstraction), each card showing company, role, per-card age (days since `last_activity_at` — the `relativeTime` helper from Layer 2), résumé version. Rejected column can be collapsed/summarized by default (`--all` to expand) — a long search accumulates many rejections and they shouldn't drown the active pipeline. Empty state guides toward `apply`/`sync`.

**`src/commands/app.ts` — `employed app <id>`:**

Full detail of one application: header (company, role, status, résumé, key dates) + the complete event timeline from `EventRepository.listForApplication` — the audit trail, oldest to newest, each event with its date, type, and note. This is where the append-only log pays off visibly.

**`src/commands/note.ts` — `employed note <id> "<text>"`:**

Appends a `note`-type event (doesn't change status). Bumps `last_activity_at`.

**`src/commands/move.ts` — `employed move <id> <status>`:**

Manual status transition via `ApplicationService.transition`. `<status>` validated against the `AppStatus` enum with a helpful error listing valid values. An unusual transition prints a one-line heads-up but proceeds.

**`src/commands/dismiss.ts` — `employed dismiss <jobId>`:**

The job-lifecycle command (§7.5, distinct from applications) — marks a _scraped job_ `dismissed` so it's excluded from future reports. Not an application action; it's saying "not interested, stop showing me this." `JobRepository.dismiss` already exists (Layer 2) — this is its command surface. (v1: dismissal trains nothing, per §7.5/§16 — just filters.)

**Architectural notes:**

- **One transition method, always.** If any code path sets `applications.status` without going through `transition`, the audit log develops holes and `stats` silently lies. Refactor sync (Unit 2) to route through it now — don't leave two write paths.
- Applications have **two origins** (scraped-job-linked and manual/Gmail) and the schema/service handle both uniformly — `board` and `stats` never care which origin a row has. Keep that invariance.
- `dismiss` (jobs) vs `move`/status (applications) are different domains — a dismissed job you never applied to, vs. a rejected application you did. Keep the vocabulary distinct in help text so they're never confused.
- Transition validation is **advisory, not restrictive** — the tool serves a messy real-world process; it warns on the weird but never blocks the user from recording what actually happened.

**Acceptance criteria:**

- `apply <jobId>` creates a linked application with an initial `applied` event and the résumé label; re-running shows the existing app, no duplicate.
- `createManual` produces a `job_id`-null application that appears in `board` identically to a linked one.
- `transition` appends an event every time, updates status, sets `first_response_at` on the first post-applied event, bumps `last_activity_at`; an unusual transition warns but succeeds.
- Sync's status updates (Unit 2) now route through `transition` — verify a sync-driven rejection produces the same event shape as a manual `move ... rejected`.
- `board` renders five columns with correct membership and per-card ages; `--all` expands rejected.
- `app <id>` shows the full chronological event timeline including sync-generated `email` events and manual notes.
- `note` appends without changing status; `move` to an invalid status errors with the valid list.
- `dismiss <jobId>` removes the job from subsequent reports (verify `new`/report excludes it) without touching any application.
- All CRM writes auditable via the events log; no status write bypasses `transition` (grep/architecture check).
- Suite offline on `:memory:`.

---

That completes **Layer 5** — Gmail sync and the full application CRM are live. Say **next** for Layer 6, Unit 1: `employed stats` (§7.8) — the SQL analytics, sparkline, and follow-up nudges.

## Layer 5, Unit 2: Gmail Sync via MCP — Fetch, AI Fallback, Ledger, Sync Modes

**What this is:** Wiring the pure classifier (Unit 1) to real email. The AI CLI (Claude Code or Codex) does the _retrieval_ through its own Gmail MCP connection — so `employed` never touches Google credentials (§8.2, and the whole reason the delegation architecture exists). Rules classify the majority for free; the low-confidence tail batches to the AI. An idempotency ledger means the same email is never processed twice. Two modes: interactive (you approve) and cron (high-confidence auto-applies, rest defers).

The discipline: retrieval and tail-classification are the _only_ AI in this unit, both go through the Unit-5 runner (budget/cache/validation for free), and the whole thing degrades to a clean no-op when AI is unavailable (§8.5).

---

**Deliverables:**

**`prompts/email_fetch_v1.txt` — EMAIL_FETCH (§8.6-B):**

The retrieval template. Query: `newer_than:{days}d` plus the ATS-and-subject query ported from the prototype's §5. Instructs the agent to paginate up to 250 threads via the Gmail MCP search tool and return **only** a JSON array of `{threadId, date, sender, subject, snippet}` — no prose. This is the `EmailMeta[]` contract from Unit 1, now produced for real.

**`prompts/email_classify_v1.txt` — EMAIL_CLASSIFY (§8.6-C):**

The tail classifier. Input: the array of low-confidence `{id, sender, subject, snippet}`. Output: `[{id, type, company, role}]` per §8.6-C's enum. Only the emails the rules couldn't place go here — the rules already handled the confident majority for free.

**`src/gmail/fetch.ts` — `EmailFetcher`:**

```typescript
async fetch(days: number): Promise<EmailMeta[]>;
```

Builds an `AiTask<EmailMeta[]>` — templateId `email_fetch_v1`, schema = zod array of `EmailMeta`, `allowedTools: ['mcp__gmail__search_threads']` (Claude path). **Provider asymmetry handled inside the runner/provider** (from Unit 5): Claude gets the per-call tool grant; Codex relies on its `config.toml` MCP setup and the prompt naming the tool — the fetcher doesn't branch on provider, it just declares the tool it needs. `inputDigest` = hash of `days` + query (cache is short-lived here — email changes constantly — so this task should set a **cache bypass** flag: fetching is inherently fresh. Add `noCache?: boolean` to `AiTask`; EMAIL_FETCH sets it. Generation/scoring keep caching; retrieval opts out).

**`src/gmail/ai-classify.ts` — `AiTailClassifier`:**

```typescript
async classify(lowConfidence: EmailMeta[]): Promise<Classification[]>;
```

`AiTask<Classification[]>`, templateId `email_classify_v1`. This one _does_ cache (same email → same classification is stable and safe), keyed on the batch digest. Empty input → returns `[]` without an AI call (don't spend budget on nothing).

**`src/services/sync.ts` — `SyncService` (the six-stage pipeline, §7.7):**

```typescript
async run(mode: 'interactive' | 'cron', opts: { days: number }): Promise<SyncResult>;
```

1. **Query & fetch** — `EmailFetcher.fetch(days)` → `EmailMeta[]`.
2. **Seen-filter** — drop threads already in `email_threads` (the ledger). Idempotency: a thread processed yesterday is skipped today. `EmailThreadRepository` (new).
3. **Rule-classify** — `classify()` each unseen email (Unit 1). Split into `high` and `low` confidence.
4. **AI tail** — `low` batch → `AiTailClassifier` (skipped entirely if `ctx.ai === null`; those emails stay unresolved and are reported, never guessed).
5. **Extract & resolve** — `extractCompany`/`extractRole` per email; produce proposed CRM actions: create-application, or status-update on an existing application (matched by company + role).
6. **Suggest or apply** by mode:
   - **interactive** — render proposals; `@clack/prompts` multi-select to accept (new dependency lands here); accepted proposals write applications/events, then record the thread in the ledger. Rejected proposals still get **ledgered as processed** (so they don't re-surface every sync) but tagged with their classification for audit.
   - **cron** — auto-apply only **high-confidence, exact-company-match status updates** (§7.7); everything else defers to the next interactive sync. Every auto-application is logged into the report's auto-applied section (the reserved slot from Layer 4 Unit 2 — now filled) so nothing happens invisibly. All fetched threads get ledgered regardless.

**New dependency:** `@clack/prompts` (interactive multi-select).

**`src/db/repositories/emailThreads.ts`, `applications.ts`, `events.ts`:**

The ledger repo (`markProcessed`, `isSeen`, batch `seenThreadIds`) plus the first slices of the application/event repos that sync needs: `ApplicationRepository.findByCompanyRole`, `create`, `updateStatus`; `EventRepository.append`. Full CRM command coverage is Unit 3 — here we build only what sync writes. Every status change appends an `events` row (§5, append-only audit) — sync-driven updates are events too, tagged `email`.

**`src/commands/sync.ts` — `employed sync [--days 30]`:**

Interactive mode. Spinner through fetch (the one slow, AI-driven step) → rules run instantly → AI tail if needed → proposals table → multi-select → apply. Summary: N fetched, M new-processed, K applied, and how many deferred/unresolved. `ctx.ai === null` → clean message ("Gmail sync needs an AI provider with Gmail MCP configured — see doctor"), exit 0, no crash.

**`run` integration:** the reserved Gmail hook in `RunService` (Layer 4 Unit 3) now calls `SyncService.run('cron', ...)` when AI + Gmail are configured. This is where the morning run's auto-applied section gets populated.

**Architectural notes:**

- **Rules first, AI second — always.** The rule classifier handles the validated majority at zero cost/latency; the AI only sees what fell through. Never route all email to AI "for consistency" — that burns budget and the 5-hour ChatGPT-plan window (the Codex caveat from the provider research) on emails the free rules already nail.
- The ledger makes sync idempotent and re-runnable — the same property `run` relies on. A thread is processed exactly once, ever, even across interactive and cron syncs.
- Cron mode's "high-confidence exact-match only, defer the rest" rule is a **safety boundary**: automated runs never make ambiguous CRM changes unattended. Auto-applied actions are always surfaced in the report. Encode this conservatively — when in doubt, defer.
- Retrieval opts out of caching; classification opts in. Make the caching decision explicit per task, not global.

**Acceptance criteria:**

- Fake-AI fetch returning a fixture `EmailMeta[]` → pipeline runs end-to-end on `:memory:`; rules classify the confident ones, only low-confidence go to the (fake) AI tail classifier.
- Ledger idempotency: running sync twice over the same fixture inbox → second run processes 0 new threads.
- Cron mode: a high-confidence exact-match rejection auto-updates the application + appends an `email` event + lands in the report's auto-applied section; a low-confidence email is deferred, not applied.
- Interactive mode (scriptable prompt fake): accepting a proposal writes the application/event; rejecting still ledgers the thread so it doesn't recur.
- `ctx.ai === null`: `sync` and the cron hook both no-op cleanly with a notice; nothing written, exit 0.
- EMAIL_FETCH task bypasses cache (two fetches → two AI calls); EMAIL_CLASSIFY uses cache (same batch → one call); empty low-confidence batch → zero AI calls.
- Every CRM write from sync appends a corresponding `events` row.
- Suite offline; the only AI is the fake runner; Gmail MCP is never actually contacted in tests.

---

Say **next** for Layer 5, Unit 3: the CRM commands — `apply`, `board`, `app`, `note`, `move`, `dismiss`.

## Layer 5, Unit 1: Rule-Based Email Classifier + Company Extractor

**What this is:** The pure-TypeScript core of Gmail sync (§7.7) — the ordered regex classifier and two-tier company extractor, ported _as-is_ from the validated prototype (11/11 classification, 9/9 extraction on the owner's real inbox). No Gmail, no AI, no network — this unit is just the deterministic brain that decides "what kind of email is this and who's it from," fed by fixtures. The AI-powered _retrieval_ and the ambiguous-tail fallback come next unit; this is the free, fast, known-good layer that handles the majority.

The discipline: this is a **port, not a redesign**. The prototype's rules are proven against real data — the job is to move them into the architecture cleanly and lock them behind the fixture suite, not to "improve" them. Any change to a rule risks regressing a validated case.

---

**Deliverables:**

**`src/gmail/types.ts` — the email domain shapes:**

```typescript
export interface EmailMeta {
  // what the fetch layer (next unit) will provide
  threadId: string;
  date: string;
  sender: string; // full "Name <addr@domain>" or bare address
  subject: string;
  snippet: string;
}
export type EmailClass =
  | "applied"
  | "oa"
  | "interview"
  | "offer"
  | "rejected"
  | "ignore";
export interface Classification {
  type: EmailClass;
  company: string | null;
  role: string | null;
  confidence: "high" | "low"; // rule match = high; anything falling through = low (→ AI next unit)
}
```

`EmailMeta` is defined here even though nothing produces it yet — it's the contract the fetch layer implements against, so the classifier is written and tested before the fetch exists (interface-first, same as the detector seam).

**`src/gmail/classify.ts` — the ordered rule classifier (§7.7, ported verbatim):**

The exact ordered pipeline from the prototype — order is load-bearing, document why each step precedes the next:

1. **ignore** — surveys, job alerts, newsletters (filtered first so they never false-match downstream)
2. **rejected** — tested _before_ confirmation, because rejections contain "thank you for your interest" which would otherwise match an `applied` pattern. This ordering is the single most important correctness detail in the whole classifier — comment it emphatically.
3. **offer**
4. **oa** — online assessment invites
5. **interview** — interview/recruiter-call requests
6. **applied** — application confirmations
7. **unknown** → emitted as `type: 'ignore'`? No — falls through as a distinct low-confidence signal the next unit routes to AI. Represent fall-through as `confidence: 'low'` with a best-guess or null type, _not_ collapsed into `ignore` (an unclassified email is not the same as a deliberately-ignored one).

Each stage is a named predicate over subject + snippet (+ sender where the prototype used it). Pure function `classify(email: EmailMeta): Classification`. Keep the regexes in a readable, commented table — these are the tuned, validated patterns; treat them as data.

**`src/gmail/extract-company.ts` — the two-tier company extractor (ported):**

The validated two-tier heuristic:

- **Tier 1 — subject patterns first:** e.g. Ashby-style "no-reply@ashbyhq.com" whose _subject_ names the company (→ Whatnot).
- **Tier 2 — sender-domain heuristics:** map ATS sender domains to the real company via the message, e.g. `redhat@myworkday.com` → Red Hat, `rb@myworkday.com` → Federal Reserve Bank of Atlanta.

Ported with its exact validated mappings/logic. Pure function `extractCompany(email: EmailMeta): string | null`. Role extraction (`extractRole`) where the prototype did it. These are the 9/9-validated cases — the fixture suite pins every one.

**`src/gmail/index.ts`:** public surface — `classify`, `extractCompany`, types.

**`test/fixtures/gmail/` — the validated sample suite:**

The 11 classification samples and 9 extraction samples from the prototype's real-inbox validation, as fixtures with expected outputs. This suite is the regression contract: it must go green and stay green. Include the specifically-cited tricky cases (Red Hat via Workday, Whatnot via Ashby subject, Federal Reserve Bank of Atlanta via Workday) as named tests — these are the ones that prove the two-tier extractor and the reject-before-confirm ordering actually work.

**Architectural notes:**

- **Port fidelity over cleverness.** If porting reveals a genuine bug, fix it _and add a fixture that locks the fix_ — but don't refactor validated regexes for elegance. The prototype earned these numbers against real email; the architecture's job is to preserve that, not second-guess it.
- Classifier and extractor are **independent pure functions** — classification doesn't depend on company, extraction doesn't depend on type. The next unit composes them; keeping them separate means each is testable and reusable alone (e.g. `stats` might extract company from an email without classifying it).
- `confidence` is the seam to the AI fallback: `high` = a rule fired and we trust it; `low` = fell through, needs the AI classifier next unit. Nothing in _this_ unit ever calls AI — it just labels what it couldn't confidently place.
- No I/O anywhere. This entire unit's tests import no http, no AI, no DB — same purity bar as the scoring engine.

**Acceptance criteria:**

- The 11-sample classification fixture suite passes 11/11, including reject-before-confirm ordering proven by a rejection containing "thank you for your interest" classifying as `rejected`, not `applied`.
- The 9-sample company-extraction suite passes 9/9, with the three named tricky cases (Red Hat, Whatnot, Federal Reserve Bank of Atlanta) as explicit assertions.
- Fall-through email (matches no rule) → `confidence: 'low'`, not silently `ignore`.
- ignore-first proven: a job-alert email that also contains interview-ish words classifies as `ignore`.
- Classifier and extractor each tested in isolation with no cross-dependency.
- Zero I/O imports in the unit and its tests.

---

Say **next** for Layer 5, Unit 2: Gmail sync via MCP — the EMAIL_FETCH/EMAIL_CLASSIFY templates, the `email_threads` idempotency ledger, and the interactive-vs-cron sync modes.

## Layer 4, Unit 3: `employed run` Orchestration + Scheduler (§9)

**What this is:** The keystone that ties Layers 1–4 into one command. `employed run` is the single idempotent entry point the scheduler fires every morning: scrape all companies (tier-aware, polite, self-healing) → score → write the report → optionally email. Plus the OS-level scheduler installer. This is the "jobs come to me at 7am" payoff. The discipline: `run` is _pure orchestration_ — it calls services built in prior units and owns run-scoped state (budgets, the observability row); it contains no scraping, scoring, or reporting logic of its own.

---

**Deliverables:**

**`src/services/run.ts` — `RunService.execute(opts): RunSummary`:**

The orchestration spine. Flow:

1. **Open a `runs` row** (`RunRepository.start()` — new repository, this unit) with `started_at`. This row is the observability record (§12); it's updated at the end, so a crashed run leaves a `started_at` with null `finished_at` — itself a useful signal `doctor` can flag.
2. **Select companies by tier schedule** (§4 tier semantics — the cost-control heart of 150-company scale):
   - Tier A → every run
   - Tier B → every run via cheap paths (ATS/static); Playwright-only B companies every 2nd run
   - Tier C → every 3rd run

   "Every Nth run" needs a stable run counter — store it in a tiny `meta` key-value table (migration 3) or derive from `runs` count. The tier filter is a **pure function** `selectCompaniesForRun(companies, runIndex): CompanyRow[]` — unit-tested in isolation, no I/O. `--tier A,B,C` override forces a specific set (ignores the schedule).

3. **Scrape the selected set** through `ScrapeService`, threading the run-scoped `HealBudget` (from Layer 3 Unit 7) so global heal caps apply across the whole run. Each company: scrape → (heal on failure) → score → upsert, all already built. `run` just loops and aggregates. **One company's failure never aborts the loop** (§12) — failures collect into an array for the `runs.failures` JSON and the report.
4. **Lifecycle sweep:** mark jobs `closed` that were absent for 2 consecutive successful scrapes of their company (§5/§7.5 — the deferred `markClosedIfUnseen`, implemented now that "a run" is a real concept). Needs per-company "seen this run" tracking against last run's set.
5. **Gmail sync** — reserved call site (`if (ctx.ai && config gmail enabled) syncService.run('cron')`), a no-op stub until Layer 5. Placing the hook now means Layer 5 wires in without touching `run`.
6. **Build + write the report** (Layer 4 Unit 2), passing the just-computed `RunStats` (companies scanned, jobs seen/new, failures, scrapers healed/broken, AI calls) so the report header is populated. Optional email — reserved hook, delivered in Layer 6.
7. **Close the `runs` row** (`finished_at`, all counts, failures JSON, `ai_calls` from the runner's per-run counter) in a `finally` so it's recorded even on partial failure. `BrowserPool.close()` in the same `finally`.

Returns a `RunSummary` the command renders. Emits progress through the UI (per-company spinner lines live, plain progress when scheduled).

**`src/commands/run.ts` — `employed run [--email] [--no-ai] [--tier A,B,C]`:**

Thin. `--no-ai` forces `ctx.ai` off for this invocation (degradation ladder on demand — Tier-1 scraping still works, generation/heal/gmail skip). `--email` flips the email hook. Renders the `RunSummary` as a terminal digest at the end; the markdown file is written unconditionally.

**`src/services/schedule.ts` + `src/commands/schedule.ts` — `employed schedule install|remove|status [--at HH:MM]` (§9):**

OS-detecting installer that _generates and prints_ the artifact for confirmation before writing:

- **macOS (launchd):** write `~/Library/LaunchAgents/com.employed.daily.plist` with `StartCalendarInterval {Hour, Minute}` from `--at` (default from `config.run.time`), `RunAtLoad false`, stdout/stderr → `~/.employed/logs/`. Load via `launchctl`. launchd fires missed jobs on wake — call this out (matters for a laptop that's asleep at 7am).
- **Linux (cron):** upsert a crontab line `M H * * * /path/to/employed run --email >> ~/.employed/logs/run.log 2>&1`.
- `remove` unloads/removes; `status` reports whether installed and the next fire time. Never silently clobber an existing entry — detect and confirm.

The absolute path to the `employed` binary is resolved at install time (`process.execPath` + script path, or the `npm link` global) and baked into the artifact — a scheduled job has no PATH assumptions.

**`src/util/lock.ts` — run lock:**

A pidfile at `~/.employed/run.lock` so a manual `run` and the 7am scheduled `run` can't collide (SQLite WAL tolerates concurrency, but double-scraping and double-reporting is wasteful and confusing). Acquire at run start, release in `finally`, stale-lock detection (pid not alive → reclaim). Small but important the moment scheduling is real.

**Observability:** this unit makes the `runs` table live. `doctor` gains a "last run" line (when, duration, new jobs, failures) — small addition to the existing doctor command.

**Architectural notes:**

- `run` orchestrates; it owns _run-scoped state_ (run index, heal budget, AI budget counter, the `runs` row, the lock) and nothing else. Every actual capability is a prior unit's service. If `run` grows domain logic, it's misplaced.
- Idempotency is a hard requirement (§9): re-running the same day is safe — dedupe (upsert), report overwrite, and the lock guarantee it. Test this explicitly.
- The tier scheduler is pure and unit-tested — the one piece of genuinely new logic here, and the one most likely to have off-by-one "every Nth run" bugs.
- Reserved hooks (Gmail sync, email) are wired as call sites now so Layers 5–6 slot in without editing `run` — the orchestration shape is finalized here.

**Acceptance criteria:**

- `selectCompaniesForRun` unit tests: run index 1/2/3 select the right tier sets; Playwright-only B staggers on even runs; C on every 3rd; `--tier` override bypasses schedule.
- `employed run` on a seeded set scrapes, scores, writes a dated report with populated run stats, closes the `runs` row with correct counts.
- Idempotency: two consecutive `run`s same day → second finds 0 new, report overwrites, no duplicate jobs, both `runs` rows recorded.
- Failure isolation: one company with a bad slug fails, `run` completes, failure appears in `runs.failures` and the report's needs-attention.
- Lifecycle: a job absent for 2 successful scrapes flips to `closed`.
- Heal budget threads correctly: global 5-heal cap holds across a multi-company run (not per-company).
- `--no-ai`: Tier-1 companies still scrape; generation/heal skipped with notes; `runs.ai_calls = 0`.
- `schedule install --at 07:30` produces a valid launchd plist (macOS) / crontab line (Linux) with an absolute binary path; `status` reports it; `remove` cleans up. Generated artifact shown before writing.
- Lock: a second `run` while one holds the lock refuses cleanly; a stale lock (dead pid) is reclaimed.
- Crash simulation: a thrown error mid-run still closes the `runs` row (finally) and releases the lock and browser.

## Layer 4, Unit 2: Report Writer + `employed new` (§7.9)

**What this is:** Turning stored, scored jobs into the actual morning deliverable — a dated markdown file (always) and an interactive terminal view. This is the first output a _human reading the report_ consumes, so the discipline is separating the **report data model** (pure, queryable, JSON-able) from its **renderers** (markdown, terminal, later email). One data shape, three presentations — so adding the email digest in Layer 6 is a renderer, not a rewrite.

---

**Deliverables:**

**`src/report/model.ts` — the report data model (pure):**

```typescript
export interface DailyReport {
  date: string; // YYYY-MM-DD
  runStats: RunStats | null; // companies scanned, new, failures, healed/broken — null until run unit exists
  newJobsByBand: Record<Band, ReportJob[]>; // A first
  autoApplied: AutoAppliedUpdate[]; // empty until Gmail unit — reserve the slot now
  needsAttention: AttentionItem[]; // broken scrapers, follow-ups — partial now, grows later
}
export interface ReportJob {
  score: number;
  band: Band;
  company: string;
  title: string;
  location: string | null;
  url: string;
  ageDays: number;
  titleOnly: boolean;
}
```

The model reserves slots for things that don't exist yet (`autoApplied`, full `runStats`, follow-up nudges) so the renderers are written once against the final shape — later units _fill_ these arrays rather than restructuring the report. `null`/empty sections render as omitted, not as errors.

**`src/report/build.ts` — `buildDailyReport(date, deps): DailyReport`:**

Pure-ish assembler (reads DB, no network, no clock beyond the passed-in date): query `JobRepository.findNewSince(date)` (jobs with `first_seen = date`, status `open`), group by band, sort within band by score desc, compute `ageDays` from `first_seen` vs. a passed-in "now". Pull broken-scraper companies (`health = 'broken'`) into `needsAttention`. `runStats` reads the latest `runs` row if present, else `null`. The date and now are _parameters_ — never `new Date()` inside — so reports are reproducible and testable.

**`src/report/render/markdown.ts` — `renderMarkdown(report): string`:**

The §7.9 file structure, in order: header with run stats (or "manual scan" line when `runStats` null) → new jobs grouped by band (A first), each job a line with score, company, title, location, age, URL, and a `title-only` marker where flagged → auto-applied section (omitted when empty) → needs-attention section (broken scrapers, later follow-ups). Clean markdown a human reads in any viewer. The optional AI-written 3-sentence summary at the top is a **reserved hook** (`report.summary?: string`) — the DIGEST prompt and its generation land in Layer 6; here the renderer just prints it if present, skips it if not (§7.9: "skipped without complaint if unavailable").

**`src/report/render/terminal.ts` — `renderTerminal(report, ui): void`:**

Same model → the animated/colored terminal view for `employed new`. Band headers, color-coded bands, per-job rows via the UI table abstraction. Reuses the health/band color map from the UI layer. Plain fallback automatic (piped output).

**`src/report/writer.ts` — `writeReport(report): string`:**

Writes `renderMarkdown` to `~/.employed/reports/YYYY-MM-DD.md` (path from constants), returns the path. Idempotent — re-running a day overwrites cleanly (the daily `run` unit calls this; dedupe upstream means the content is stable).

**`src/commands/new.ts` — `employed new [--band A,B] [--today] [--json]`:**

- Default: build today's report, render to terminal.
- `--band A,B` — filter to specific bands (filtering happens on the _model_ — a pure `filterReport(report, bands)` — so markdown/terminal/json all honor it identically).
- `--today` — restrict to jobs first seen today (vs. the default which could show a rolling window; define the default window explicitly — spec implies today-first, so default = today, and a future `--since` extends it).
- `--json` — `JSON.stringify(report)` to stdout, nothing else. This is trivial _because_ the model is already the serializable source of truth — the exact payoff of the "services return data, commands render" rule enforced since Layer 2. This JSON is also the contract the "Job Search HQ" dashboard consumes (§15), so treat its shape as semi-public.

**Architectural notes:**

- Three renderers, one model — if a renderer needs data the model doesn't have, the fix is to enrich the _model_, never to have a renderer query the DB directly. Renderers are pure `(model) → output`.
- `buildDailyReport` takes `now`/`date` as inputs — this "no ambient clock" rule makes the whole report layer deterministic under test and is worth enforcing strictly.
- The report is generated fresh from the DB each time, not stored-and-mutated — the DB is the source of truth, the report is a projection. (The `.md` file is an _export_ of that projection, not a second source.)

**Acceptance criteria:**

- `buildDailyReport` on a seeded `:memory:` DB produces correct band grouping, within-band score-desc ordering, correct `ageDays`, broken scrapers in needsAttention.
- `renderMarkdown` output matches the §7.9 section order; a report with empty auto-applied/summary omits those sections cleanly; a title-only job shows its marker.
- `--json` emits valid JSON that round-trips to the same `DailyReport`; `--band A` filters identically across json and terminal.
- `writeReport` creates the dated file at the right path; re-running overwrites, doesn't duplicate.
- Determinism: same seeded DB + same `now` → byte-identical markdown across runs.
- Terminal render is colored in TTY, plain when piped.
- Report layer tests import no http, no AI, no scheduler.

---

Say **next** for Layer 4, Unit 3: `employed run` orchestration + the scheduler (§9) — the tier-aware full loop, the `runs` observability row, and launchd/cron install.

## Layer 4, Unit 1: Scoring Engine (§7.6)

**What this is:** The pure-TypeScript scoring core — identical math to the validated prototype, no AI, so 500 jobs score in milliseconds. This is the simplest unit in the whole build (it's a weighted substring counter) but it's load-bearing: it's what turns a pile of scraped postings into a _ranked_ morning report. The discipline here is keeping it pure and keeping `matched_kw` populated for the analytics that come in Layer 6.

---

**Deliverables:**

**`src/score/engine.ts` — the pure engine:**

```typescript
export interface ScoreResult {
  score: number;
  band: Band; // 'A' | 'B' | 'C' | 'D'
  matchedKeywords: string[]; // every keyword that fired, across all three lists
  titleOnly: boolean; // true when description was absent (§7.6 flag)
}
export function scoreJob(
  job: { title: string; description?: string | null },
  keywords: KeywordsFile,
): ScoreResult;
```

The math, verbatim from §7.6:

- `score = 2·Σ(title hits) + Σ(desc hits) − 2·Σ(neg hits)`
- title keyword weights count ×2, desc weights ×1, negative weights ×−2 — but note the _weights themselves_ live in `keywords.yaml`; the ×2/×1/×−2 are the list multipliers applied on top of each keyword's configured weight. Re-read the seed profile carefully: `new grad 6` in the title list contributes `2 × 6 = 12` when "new grad" appears in the title. Encode this as: for each list, `listMultiplier × Σ(keywordWeight for each matched keyword)`.
- Matching: **case-insensitive substring** over the relevant text. Title keywords match against title only; desc keywords match against description only; negative keywords match against **title + description combined** (a "senior" in either place should penalize).
- Bands: `A ≥ 30, B ≥ 18, C ≥ 8, D < 8`. Put thresholds in exported constants (`BAND_THRESHOLDS`) — the report groups by these, `stats` references them, one source of truth.
- `titleOnly: true` when `description` is null/empty (Tier-2/3 and some ATS list endpoints) — the job still scores on title, but the report flags it so a low score on a title-only job reads as "unknown," not "bad fit."

Purity is the rule: no DB, no I/O, no clock. `(job, keywords) → result`. This makes it exhaustively testable and reusable (the future `score --ai` note, re-scoring after a keyword edit, etc.).

**`src/score/index.ts`:** public surface — `scoreJob`, `ScoreResult`, `BAND_THRESHOLDS`.

**Wiring into the pipeline (`ScrapeService`):**

After normalization, before/within the upsert transaction: score each new-or-updated job, and persist `score`, `band`, `matched_kw` (JSON array) to the `jobs` row. `JobRepository.upsert` gains score fields in its insert/update — but the _computation_ stays in `ScrapeService` calling the pure engine (repository stores, engine computes, service orchestrates — the same three-way boundary as everywhere else). `ScrapeService` gets the loaded `KeywordsFile` via constructor (from `ConfigService`) — injected, so a test scores against a fixture keyword profile.

**Re-scoring path:** because keyword weights are tuned over time, add `employed rescore` (small command): re-run `scoreJob` over all `open` jobs with the current `keywords.yaml` and update their scores/bands. Pure engine + a bulk update — no scraping, no network. This is why scoring is decoupled from scraping: editing a weight shouldn't require re-scraping every company. `JobRepository.listOpen()` + a batched `updateScore(id, ...)` in a transaction.

**Command surface touch:** `employed scan --company X` output (from Layer 3) now shows band + score per new job in its table — the scoring is visible immediately. Column order: Score, Band, Title, Location — ranked desc by score.

**Architectural notes:**

- Negative-keyword matching over combined text is a deliberate spec reading — document it in a comment so a future reader doesn't "fix" it to title-only.
- `matched_kw` is stored even though nothing reads it until Layer 6's keyword→response correlation. Storing signal you'll need later is cheap; backfilling it isn't. Don't defer the write.
- The list multipliers (2/1/−2) are structural and belong in `engine.ts` as named constants (`TITLE_MULTIPLIER` etc.), _not_ in config — they're the scoring model's shape, not a user knob. Only the per-keyword weights are user-tunable. Keep this line crisp: change a weight → edit yaml; change the model → edit code (and bump a version).

**Acceptance criteria:**

- Engine unit tests reproduce the §7.6 math exactly on a fixture set: a job titled "New Grad Software Engineer 2026" with a matching description lands in band A with the correct integer score; a "Senior Staff Engineer" title scores negative; a title-only job scores on title alone with `titleOnly: true`.
- Every band boundary tested (score exactly 30→A, 29→B, 18→B, 17→C, 8→C, 7→D).
- Case-insensitivity proven ("SOFTWARE ENGINEER" == "software engineer"); substring proven ("backend" matches "Backend Engineer").
- `matched_kw` contains exactly the keywords that fired, no duplicates, across all three lists.
- Pipeline: `scan` persists score/band/matched_kw; re-scanning an unchanged job keeps them consistent.
- `employed rescore` after editing a weight in `keywords.yaml` updates existing jobs' scores without any network call (assert zero HTTP via fake client).
- Engine is pure: its test file imports no DB, no http, no fs.

---

Say **next** for Layer 4, Unit 2: the report writer + `employed new` — the dated markdown report, band grouping, and `--json` output.

## Layer 3, Unit 7: Playwright Strategy + Self-Healing Loop

**What this is:** The two pieces that make the scraper fleet client-side-render-capable _and_ self-maintaining (§7.4). Playwright handles the pages static fetch can't; self-healing is the loop that regenerates rotted configs automatically, with Claude/Codex as the repair crew and the owner paged only when the AI is stumped. This closes out Layer 3 — after this, the scraping subsystem is feature-complete and maintains itself.

---

**Deliverables:**

**New dependency:** `playwright` (chromium only — `npx playwright install chromium` documented as a setup step in README).

**`src/scrape/browser.ts` — shared browser lifecycle:**

```typescript
export class BrowserPool {
  async page<T>(fn: (page: Page) => Promise<T>): Promise<T>; // borrow→use→release
  async close(): Promise<void>;
}
```

One shared chromium instance per run (§10: "single shared browser per run"), lazily launched on first use — a run that touches zero Playwright companies never launches a browser. Per-page hardening from §10: block `image`/`font`/`media` resource types via routing, 30s nav timeout, `networkidle` wait. Pages are borrowed and released (not one browser per company — that's the 100× cost the tier system exists to avoid). `close()` called in the run's `finally`. Constructed once, added to scrape-layer deps (not `CommandContext` — only the scrape service needs it, keep the context lean).

**`src/scrape/generated.ts` — extend the executor with the Playwright strategy:**

Split the existing single executor by strategy. Refactor `GeneratedSource` so `strategy: 'static'` keeps the cheerio path (unchanged) and `strategy: 'playwright'` uses `BrowserPool`: navigate → wait for `listSelector` to appear (with timeout) → run the _same_ field-extraction logic against the rendered DOM (extract via `page.$$eval` or serialize rendered HTML back through the existing cheerio extractor — prefer the latter so **field extraction stays one code path** for both strategies; only _acquisition_ differs). Pagination the static path couldn't do now works:

- `load-more-button` → click `value` selector, wait for network idle, repeat until button absent or `maxPages`
- `infinite-scroll` → scroll to bottom, wait, repeat until scroll height stabilizes or `maxPages`
- `next-link` / `url-param` → same as static but via navigation

The `RequiresRenderError` that the static executor threw in Unit 6 is now caught upstream and re-routed here. `method` is `generated-playwright`.

**Generation service update (`GenerateService`):** the `pendingPlaywright` path from Unit 6 completes — when static generation hits `RequiresRenderError` (or the AI returns `strategy: 'playwright'` directly), re-capture the page _with Playwright_ for distillation (client-rendered pages have empty static HTML — distilling the raw fetch would give the AI nothing), then run the same generate→validate gate against the Playwright executor. This is the §7.3-step-1 branch ("if fetched HTML has <3 job links, re-capture with Playwright") finally implemented.

**`src/services/heal.ts` — `HealService` (§7.4, the defining reliability feature):**

```typescript
async heal(company: CompanyRow, runBudget: HealBudget): Promise<HealResult>;
```

Triggered by `ScrapeService` when a previously-`ok` company yields zero jobs or throws a parse error during a scan. The loop:

1. **First failure** → `recordFailure` (increments `consecutive_failures`), `updateHealth('degraded')`. **Do not heal yet** — could be a transient outage (§7.4). Return `{ healed: false, deferred: true }`.
2. **Second consecutive failure** → attempt heal, gated by `HealBudget`: max 2 attempts per company per run, max 5 heals per run globally (cost control at 150-company scale). The budget is a run-scoped counter object passed in — the `run` orchestration unit owns and threads it.
3. **Heal path branches by method:**
   - **ATS-method company** → re-run _detection_ first (companies migrate ATSes — §7.4). If detection now yields a different/valid ATS, adopt it, smoke-test, done. Only if detection fails fall through to generation.
   - **generated-\* company** → re-run the full `GenerateService.generateFor` (the regeneration _is_ the heal).
4. **Heal success** → `updateHealth('ok')`, reset `consecutive_failures`, return `{ healed: true, note: 'Datadog scraper regenerated' }` for the run log.
5. **Heal failure** → `updateHealth('broken')`, return `{ healed: false }` → the run report surfaces it prominently so the owner notices (§7.4).

Guard: `ctx.ai === null` → healing is skipped entirely (generation needs the brain); degraded companies stay degraded with a report note, never crash (§8.5). ATS re-detection _can_ still run without AI (it's pure signature matching) — so an AI-less heal can still fix an ATS migration, just not regenerate a custom scraper. Encode that asymmetry: try detection-heal even when AI is null; skip generation-heal when null.

**`ScrapeService` integration:** `scrapeCompany` gains the failure→heal hookup. On a scrape that returns zero-from-a-previously-healthy company or throws: route to `HealService.heal(company, budget)`, then — if healed — _retry the scrape once_ within the same run so a self-healed company still contributes jobs today (not just next run). The budget prevents this from cascading. Wrap so a heal failure never aborts the surrounding scan (§12).

**Config additions (additive):** `run.heal.maxPerCompany: 2`, `run.heal.maxPerRun: 5`, `run.playwright.navTimeoutMs: 30000`.

**Architectural notes:**

- Field extraction is **one path** across static and Playwright — the only strategy-divergent code is DOM acquisition and pagination-click mechanics. Enforce this; it's what keeps two rendering strategies from becoming two maintenance burdens.
- Self-healing reuses `GenerateService` and `SignatureDetector` wholesale — heal is _orchestration of existing capabilities_, not new scraping logic. If `HealService` grows scraping logic of its own, something's wrong.
- The heal trigger deliberately lives in `ScrapeService`, not scattered across commands — every path that scrapes (scan, run) gets healing for free.

**Acceptance criteria:**

- Playwright executor against a local fixture server (or recorded page) serving client-rendered jobs: extraction succeeds where static returned zero; `load-more` and `infinite-scroll` pagination reach page 2+ then terminate at cap
- Resource blocking verified (no image/font requests in a captured network log); single browser instance across multiple companies in one run (assert launch count = 1)
- Heal loop unit tests with fake services: first failure → degraded, no heal; second → heal attempted; ATS company re-detects before generating; generated company regenerates; success resets counter and retries scrape; failure → broken + report note
- Heal budget: 6th heal in a run is refused with a budget note; 3rd attempt on one company refused
- `ctx.ai === null`: generated-company heal skipped with note; ATS re-detection heal still runs
- Simulated selector break (fixture): a config that worked, then a changed fixture that breaks it → 2nd run triggers heal → regenerated config extracts again (§14 M4 acceptance)
- `BrowserPool.close()` always called even when a scrape throws (assert no leaked chromium process)
- Suite offline except env-flagged live Playwright checks

---

That completes **Layer 3**. Say **next** for Layer 4, Unit 1: the scoring engine (§7.6) — pure engine, banding, `matched_kw`, and wiring it into the scrape pipeline.

## Layer 3, Unit 6: Tier-2/3 Scraper Generation — DOM Distiller, SCRAPER_GEN, Validation Gate, Executor

**What this is:** The §7.3 machinery — turning an unknown careers page into a per-company `ScraperConfig` via the AI runner, then executing that config generically. This is the first _consumer_ of the AI runner from Unit 5, and the first use of cheerio. The defining discipline: a generated config is never trusted until it's executed and passes a validation gate. This unit covers the **static** strategy only; Playwright rendering is Unit 7.

---

**Deliverables:**

**New dependency:** `cheerio`.

**`src/scrape/config.ts` — the `ScraperConfig` schema (§7.3, verbatim):**

The zod schema from the spec — `strategy`, `listSelector`, `fields` (title/url required, location/department nullable, each `{selector, attr}`), `pagination` (`type` enum + value + maxPages), `urlPrefix`, `confidence`, `notes`. This is the canonical config type; the DB's `companies.scraper_config` JSON column stores it, the executor consumes it, the generator produces it. Export `ScraperConfig = z.infer<...>`.

**`src/scrape/distill.ts` — the DOM distiller (pure, §7.3 step 2):**

```typescript
export function distillDom(html: string): {
  dom: string;
  linkDensityHint: string;
};
```

Using cheerio: strip `<script>`, `<style>`, `<svg>`, comments; strip all attributes except `id`, `class`, `href`, `aria-*`, `data-*`; collapse whitespace; find the highest-link-density subtree and truncate to ~35KB centered on it. Pure and deterministic — same HTML in, same distilled DOM out, which is what makes the AI cache key stable (unchanged page never re-pays). Heavily unit-tested on fixtures: attribute stripping, the 35KB truncation window, link-density region selection. The distilled output is also the `inputDigest` source for the AI task — `sha256(distilledDom)`.

**`prompts/scraper_gen_v1.txt` — the SCRAPER_GEN template (§8.6-A):**

Ships here (its consuming unit, per the Unit 5 convention). Placeholders: `{company}`, `{url}`, `{schema}` (the JSON-schema rendering of `ScraperConfig`), `{retry_feedback}`, `{dom}`. The retry-feedback slot is filled by the runner's own retry mechanism — but SCRAPER*GEN \_also* has a domain-level retry (validation-gate failure, below), distinct from the runner's JSON-parse retry. Keep these two retry concepts clearly separated in comments: runner retry = "your JSON was malformed"; generator retry = "your JSON was valid but the scraper it described didn't work."

**`src/scrape/generated.ts` — the executor, `GeneratedSource implements ScrapeSource`:**

The generic config runner — one function, all company-specificity in data (§7.3's closing point). For `strategy: 'static'`: `http.fetchText` → cheerio load → `$(listSelector).each` → per element, extract each field by its `{selector, attr}` (attr `"text"` → `.text().trim()`, else `.attr(name)`) → resolve relative URLs against `urlPrefix`/page origin → paginate per `pagination.type`:

- `none` → single page
- `next-link` → follow `value` selector's href until absent or `maxPages`
- `url-param` → substitute `{n}` in the `value` template, increment until an empty page or `maxPages`
- `load-more-button` / `infinite-scroll` → **static strategy can't do these** → throw a typed `RequiresRenderError` (Unit 7's Playwright executor handles them; catching this error is how the strategy escalates)

Implements `ScrapeSource`, so `getSource('generated-static', deps)` slots into the existing registry and the scan pipeline treats it identically to an ATS adapter. `method` is `generated-static`.

**`src/scrape/validate.ts` — the validation gate (§7.3 step 4, pure):**

```typescript
export function validateExtraction(postings: RawPosting[]): ValidationVerdict;
// pass criteria, all must hold:
//   ≥1 posting; every posting non-empty title + absolute URL;
//   <30% duplicate titles; median title length 8–80 chars;
//   <20% of titles match /^(home|about|benefits|log ?in|search|careers)$/i
// returns { ok: true } | { ok: false, reasons: string[] }
```

Pure function over extracted postings → the reasons array feeds the generator retry prompt. Fully unit-tested with crafted posting arrays (nav-link contamination, dup floods, empty titles).

**`src/services/generate.ts` — `GenerateService` (orchestrates §7.3 end-to-end):**

```typescript
async generateFor(company: CompanyRow): Promise<GenerateResult>;
```

Flow: fetch page → `distillDom` → build `AiTask<ScraperConfig>` (templateId `scraper_gen_v1`, schema `ScraperConfig`, digest = distilled-DOM hash) → `ai.runJson` → execute the returned config via `GeneratedSource` → `validateExtraction`:

- **pass** → persist config to `companies.scraper_config`, set `scrape_method`, `updateHealth('ok')`, record yield → `{ ok, jobCount, strategy }`
- **fail** → one domain-level retry: re-run `ai.runJson` with `{retry_feedback}` = the verdict reasons, re-execute, re-validate
- **second fail** → `updateHealth('broken')`, persist nothing (or persist with a `broken` marker for doctor), return `{ ok: false, reasons }` — never silently keep a bad config (§7.3's hard rule)

Guard the whole thing: `ctx.ai === null` (AI disabled/unavailable) → return a typed `skipped` result, no crash — generation simply can't happen without the brain, and that's fine (§8.5). One `RequiresRenderError` from the static executor → mark the company as needing Playwright (persist an intent flag or leave `strategy: 'playwright'` in a stored partial); Unit 7 picks these up. For now, surface it as `{ ok: false, reason: 'requires-render', pendingPlaywright: true }`.

**Command wiring:**

- `employed company generate <name>` — explicit generation trigger; spinner through fetch→distill→AI→validate, result line (`✓ SeatGeek — generated-static config, 38 jobs, confidence 0.82` or a clear failure with reasons).
- `CompanyService.add`'s tail: after detection returns `unknown` _and_ `ctx.ai` is available, offer/auto-run generation (config flag `run.autoGenerateOnAdd`, default true) — so adding a custom-page company in one command produces a working scraper. When AI is unavailable, add still succeeds as `unknown` with a note to run `generate` later.

**Architectural notes:**

- The `strategy` field in `ScraperConfig` means the _same_ generator prompt can return either static or playwright configs; only the _executor_ differs. Unit 7 adds a `PlaywrightGeneratedSource` and routes on `strategy` — the generation service barely changes.
- Confidence and notes are persisted but not yet acted on; `doctor` will surface low-confidence configs later. Store them now, use them later — don't drop model-provided signal.

**Acceptance criteria:**

- Distiller unit tests: script/style/svg removed, attribute whitelist enforced, 35KB cap honored, deterministic output (same input → byte-identical)
- Validation gate unit tests: each pass criterion has a passing and a failing fixture; nav-contaminated extraction fails with the right reason
- Executor tests on saved HTML fixtures + hand-written configs: static list extraction, `next-link` and `url-param` pagination (2-page fixtures), `load-more` config throws `RequiresRenderError`, relative→absolute URL resolution
- End-to-end with a **fake AI runner** returning a known-good config for a fixture page → `GenerateService` persists it, health `ok`; fake runner returning a config that extracts nav links → gate fails, one retry, then `broken`
- Cache: generating twice for an unchanged page → one AI call (distilled-DOM digest stable)
- `ctx.ai === null` → `generate` reports "AI unavailable," company unchanged, exit 0
- Live (env-flagged): `employed company generate` produces a working config for 2 real custom careers pages (§14 M3 acceptance)
- Suite offline; the only AI in tests is the fake runner

## Layer 3, Unit 5: The AI Runner — Provider-Agnostic `claude -p` / `codex exec` Integration

**What this is:** The §8 machinery, generalized per our provider decision: one disciplined pipeline (spawn → timeout → JSON extraction → zod validation → cache → budget) with pluggable providers behind an interface. No feature _uses_ AI yet — scraper generation (next unit) is the first consumer. This unit ships the engine, the preflight, and the fallback walk, fully testable with fake providers.

---

**Deliverables:**

**`src/ai/types.ts` — the contracts:**

```typescript
export interface AiProvider {
  readonly name: ProviderName; // 'claude' | 'codex' (from config schema — one source of truth)
  isAvailable(): Promise<ProviderStatus>; // binary on PATH + version; cached per process
  run(req: AiRequest): Promise<string>; // raw text out; throws AiProviderError on failure/timeout
}
export interface AiRequest {
  prompt: string;
  timeoutMs: number;
  allowedTools?: string[]; // MCP tool grants (Gmail unit uses this)
}
export interface AiRunner {
  runJson<T>(task: AiTask<T>): Promise<T>; // the ONLY surface features consume
}
export interface AiTask<T> {
  templateId: string; // versioned template name, e.g. 'scraper_gen_v1'
  input: string; // rendered prompt
  inputDigest: string; // sha256 of the semantic input (e.g. distilled DOM) — cache key part
  schema: ZodType<T>;
  timeoutMs: number;
  allowedTools?: string[];
}
```

Features never see providers, spawning, or caching — they hand the runner a task with a schema and get a typed result or a typed error. That's the whole design.

**`src/ai/providers/claude.ts` — `ClaudeCodeProvider`:**
`spawn("claude", ["-p", prompt, "--output-format", "json", ...(allowedTools ? ["--allowedTools", allowedTools.join(",")] : [])])`, argv array always (never shell interpolation — §8.1's injection rule, enforce with a lint-level comment). Parse the JSON envelope, return its `result` field. `ENOENT` → `ProviderUnavailableError` with install hint.

**`src/ai/providers/codex.ts` — `CodexProvider`:**
`spawn("codex", ["exec", "--json", prompt])`. Codex's `--json` emits event lines; extract the final agent message (verify the exact envelope against the installed CLI during the build — treat it as possibly drifted, same discipline as ATS endpoints). Add `--skip-git-repo-check`-style flags as needed so exec runs outside a repo (verify current flag names against docs; document in a comment). MCP tools: Codex grants tools via its own `config.toml`, not per-call flags — so `allowedTools` here is advisory: log a debug note if requested tools aren't grantable per-call, and let the prompt name the tools it expects. This asymmetry lives _inside_ the provider, invisible to callers.

**`src/ai/runner.ts` — `DefaultAiRunner implements AiRunner`** (the discipline, per §8.4):

Constructor: `(providers: AiProvider[], repos, config)` — providers pre-ordered by the config walk: `config.ai.preference`, filtered to `enabled` providers. Per `runJson` call:

1. **Budget gate:** per-run counter vs `maxCallsPerRun`; over budget → `AiBudgetExceededError` (callers convert to a report line, never a crash). Counter owned by the runner, reset per process; the future `run` command reports it into the `runs` row.
2. **Cache check:** key = `sha256(provider.name + templateId + inputDigest)` in `ai_cache` — provider in the key per the remediation task, so switching providers never serves the other model's answer. Hit → parse through schema → return (cache hits are free: no budget decrement).
3. **Provider walk:** first provider where `isAvailable()` → `run()`. On `ProviderUnavailableError` or timeout: log, try next in preference order. All exhausted → `AiUnavailableError`.
4. **Extract-validate-retry:** extract first JSON block from the raw text (fenced ` ```json ` block, else first balanced `{...}`/`[...]` — one helper in `src/ai/extract.ts`, heavily unit-tested). zod parse. On failure: **exactly one retry**, same provider, with the zod issues appended to the prompt (`\n\nYour previous response failed validation:\n{issues}\nRespond with ONLY corrected JSON.`). Second failure → `AiValidationError` carrying both raw responses for the log. Never guess, never partially accept.
5. **Cache write** on success.

Timeout enforcement at the spawn level (`spawn`'s `timeout` option + explicit `SIGKILL` escalation) _and_ a `Promise.race` guard in the runner — belt and suspenders, because a hung child is the worst failure mode for a cron app.

**`src/ai/index.ts`:** `buildAiRunner(deps): AiRunner | null` — returns `null` when `config.ai.enabled` is false or zero providers enabled; `CommandContext` gains `ai: AiRunner | null`. Every future consumer handles `null` as "degrade gracefully" (§8.5) — making the degradation ladder a type-level obligation, not a convention.

**`src/commands/doctor.ts` — first slice of `employed doctor`:**
Sections rendered via the UI table: **AI providers** (per configured provider: installed? version? enabled? active-by-preference marker) and **Database** (path, `user_version`, table count, integrity_check). Company-fleet health joins in a later unit. Exit code 0 even with warnings — doctor diagnoses, it doesn't fail builds.

**`prompts/` note:** templates ship with their consuming units (SCRAPER_GEN arrives next unit) — but establish the loader now: `src/ai/templates.ts` reads `prompts/<templateId>.txt`, substitutes `{placeholders}`, errors on unresolved placeholders at render time.

**Acceptance criteria:**

- Fake-provider tests: preference `[codex, claude]` with codex unavailable → claude used; both unavailable → `AiUnavailableError`; disabled provider skipped even when listed first
- Cache: same task twice → one provider call; same task, different provider active → second call (provider-scoped keys proven)
- Retry: fake provider returns invalid-then-valid JSON → one retry, success; invalid twice → `AiValidationError` with both payloads
- Budget: `maxCallsPerRun: 2`, third call → `AiBudgetExceededError`; cache hits don't count
- Extractor unit tests: fenced block, bare object, prose-wrapped object, nested braces in strings, no-JSON-at-all
- Timeout: fake provider that never resolves → killed at deadline, `AiProviderError`, process exits cleanly (no orphan child — assert via fake spawn)
- Live (manual, env-flagged): `employed doctor` correctly reports your installed `claude` and `codex` binaries with versions; flipping `preference` order in config visibly changes the active marker
- `config.ai.enabled: false` → `ctx.ai === null`, doctor says "AI disabled by config"

---

## Layer 3, Unit 4: Politeness & Robustness — the HTTP Decorator Layer

**What this is:** The §10 requirements — rate limiting, per-domain serialization with jitter, exponential backoff, ETag caching, robots.txt — implemented as **decorators wrapping `HttpClient`**, not edits to it. This is the payoff of the interface abstraction from Unit 3.1: every adapter, the detector, and the future generated-scraper executor get polite behavior with zero changes to their code, and each concern is independently testable and removable. Also: delete the Workday inline-delay TODO — its replacement arrives here.

---

**Deliverables:**

**`src/util/http/` — restructure into a directory** (public surface via `index.ts` unchanged: `HttpClient`, `FetchResult`, errors — import sites don't move):

```
src/util/http/
  index.ts          # exports + buildHttpClient() composition factory
  client.ts         # UndiciHttpClient (moved, unchanged)
  politeness.ts     # PoliteHttpClient decorator
  retry.ts          # RetryHttpClient decorator
  cache.ts          # CachingHttpClient decorator (ETag/If-Modified-Since)
  robots.ts         # RobotsGate + minimal robots.txt parser
  types.ts
```

**`politeness.ts` — `PoliteHttpClient(inner, opts)`:**

The scheduling core. Per-domain FIFO queues: requests to the _same_ registrable domain run serially with a randomized `500–1500ms` gap (jitter range from config); requests to _different_ domains run concurrently up to a global semaphore of `config.run.concurrency` (default 4). Implementation: a `Map<domain, Promise-chain>` + one counting semaphore — ~80 lines, no dependency. Domain extraction to `eTLD+1`-ish via a small helper (exact PSL correctness is overkill; `hostname.split('.').slice(-2).join('.')` with a comment noting the tradeoff). This decorator replaces Workday's inline 300ms sleep — **delete it** and its TODO.

**`retry.ts` — `RetryHttpClient(inner, opts)`:**

On `429` or `503` (and on `HttpError` timeouts): exponential backoff `1s → 2s → 4s`, max 3 attempts, honoring a `Retry-After` header when present (seconds or HTTP-date). Any other status passes through untouched — 404 is an answer, not a retryable condition. Retries route back through `inner`, so they re-enter the politeness queue rather than bypassing it (decorator ordering, below, makes this true).

**`cache.ts` — `CachingHttpClient(inner, db)`:**

New table, migration 2 (first real migration — the migration runner earns its keep):

```sql
CREATE TABLE http_cache (
  url TEXT PRIMARY KEY,
  etag TEXT, last_modified TEXT,
  body TEXT NOT NULL, content_type TEXT,
  fetched_at TEXT NOT NULL
);
```

GET-only (POST — i.e. Workday — is never cached). On hit: send `If-None-Match`/`If-Modified-Since`; on `304`, synthesize a `FetchResult` from the stored body with a `fromCache: true` flag added to `FetchResult`; on `200`, update the row. No TTL eviction in v1 — one row per company URL at 150 companies is nothing; add `employed doctor` visibility instead of an eviction policy nobody needs yet.

**`robots.ts` — `RobotsGate`:**

Fetch `https://<origin>/robots.txt` once per origin per process (memoized; fetch failure or 404 = allow-all, the standard interpretation). Minimal parser: `User-agent: *` groups, `Disallow`/`Allow` longest-match. Exposed as `isAllowed(url): Promise<boolean>`. **Enforcement lives in the scrape layer, not the HTTP stack:** `ScrapeService` consults the gate _only_ for Tier-2/3 fetches — Tier-1 ATS API calls are exempt per §10 (official public APIs). Since Tier-2/3 executors don't exist yet, this unit ships the gate + wires a `respectRobots` check into the _detection_ fetch path (the one current non-API fetch), with a typed `RobotsDisallowedError` → company marked `manual` + report-worthy detail, per the spec's hard rule.

**`index.ts` — composition root:**

```typescript
export function buildHttpClient(deps: { db; config }): HttpClient {
  return new PoliteHttpClient( // outermost: everything queues
    new RetryHttpClient( // retries re-enter...
      new CachingHttpClient(new UndiciHttpClient(), db), // ...and revalidations still hit cache
      opts,
    ),
    opts,
  );
}
```

Ordering rationale documented in a comment — this stack order means a retry waits its turn in the domain queue and a cache revalidation is still rate-limited. cli.ts swaps `new UndiciHttpClient()` for `buildHttpClient(...)`; **nothing else in the codebase changes** — that's the acceptance test of the architecture itself.

**Config additions (`schema.ts`, additive with defaults):** `run.jitterMs: { min: 500, max: 1500 }`, `run.maxRetries: 3`, `run.respectRobots: true`.

**Acceptance criteria:**

- Politeness test: 6 fake requests, 2 domains → same-domain requests strictly serial with measured gaps ≥ min jitter; cross-domain requests overlap; global cap never exceeded (instrumented fake inner client)
- Retry test: fake inner returns 429, 429, 200 → three calls, backoff delays observed (fake timers), final result surfaces; 404 → exactly one call
- Cache test: 200-with-ETag then 304 → second result `fromCache: true`, body identical, DB row single; POST bypasses entirely
- Robots test: fixture robots.txt disallowing `/jobs` → detection of that path yields `manual` + detail; robots fetch 404 → allowed
- Migration 2 applies on existing Unit-3 DBs (`user_version` 1→2) and fresh DBs identically
- Live: `employed scan --company X` twice in a row — second run visibly faster with `304`s in a `--verbose` line; grep confirms Workday inline sleep is gone
- Full suite offline, fake timers throughout — no real sleeps in tests

## Layer 3, Unit 3: Remaining ATS Adapters — Ashby, SmartRecruiters, Recruitee, Workday

**What this is:** Filling out the Tier-1 fleet. Because Unit 2 established the `ScrapeSource` contract, registry, and lenient-zod discipline, three of these are mechanical ~60-line additions. Workday is the one with real complexity — POST requests, offset pagination, and the composite slug — and it forces two small, deliberate extensions to shared infrastructure rather than one-off hacks.

---

**Deliverables:**

**Extension 1 — `HttpClient` gains POST support (`src/util/http.ts`):**

```typescript
export interface HttpClient {
  fetchText(url: string, opts?: FetchOpts): Promise<FetchResult>;
  postJson(url: string, body: unknown, opts?: FetchOpts): Promise<FetchResult>;
}
```

Same semantics as `fetchText` (timeout, UA, typed errors, non-2xx returned not thrown); sets `Content-Type: application/json`. Added to the interface _and_ both implementations (real + test fake). This is the only reason Workday needed to wait — never let one adapter grow a private HTTP path.

**Extension 2 — Workday slug codec (`src/scrape/slug.ts`):**

The `tenant|wdN|site` encoding from the detection unit gets a real home — pure functions, one source of truth shared by detection and adapter:

```typescript
export function encodeWorkdaySlug(p: {
  tenant: string;
  instance: string;
  site: string;
}): string;
export function decodeWorkdaySlug(slug: string): {
  tenant: string;
  instance: string;
  site: string;
};
// decode throws AdapterError on malformed input — never silently mis-parse
```

Refactor `signatures.ts`'s Workday rule to use `encodeWorkdaySlug` (removing its inline string-building).

**`src/scrape/adapters/ashby.ts`** — `GET https://api.ashbyhq.com/posting-api/job-board/<slug>` → response `{ jobs: [...] }`. Map: `title`→title, `jobUrl` (fallback `applyUrl`)→url, `location`→location, `department`/`team`→department, `descriptionPlain` (fallback tag-stripped `descriptionHtml`)→description, `id`→externalId. Lenient zod, only consumed fields required.

**`src/scrape/adapters/smartrecruiters.ts`** — `GET https://api.smartrecruiters.com/v1/companies/<Company>/postings` → `{ content: [...], totalFound, limit, offset }`. Map: `name`→title, posting URL built from `id` + company (verify the actual `ref`/apply-URL field against live data during the build — the spec flags drift as expected), `location.city` + `location.country`→location, `department.label`→department, `id`→externalId. **Description caveat:** the list endpoint typically omits full descriptions — leave `description: null` rather than issuing N+1 per-posting detail calls (a per-run cost we refuse at 150-company scale; title-only scoring already handles this downstream per §7.6). Paginate via `offset` if `totalFound > limit`, hard cap 5 pages.

**`src/scrape/adapters/workday.ts`** — the real work:

- `decodeWorkdaySlug(company.slug)` → build base `https://<tenant>.<instance>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs`
- `postJson` body `{ limit: 20, offset, searchText: "" }` — paginate by offset until `jobPostings` comes back empty or `total` reached; hard cap `maxPages = 25` (500 postings) as a runaway guard, log if hit
- Map: `title`→title, url = careers site origin + `externalPath`, `locationsText`→location, `externalPath`-derived or `bulletFields` req-ID→externalId (verify against live tenants; if no stable ID emerges, return `null` and let the hash path handle dedupe — that's exactly what it's for), description null (list endpoint omits it)
- Between pages: 300ms delay inline for now with a `// TODO(politeness-unit)` marker — the politeness decorator will own inter-request spacing globally; don't build the general mechanism here

**Registry update (`adapters/index.ts`):** add all four entries. Registry is now complete for Tier 1; `getSource` returns `null` only for `unknown | manual | generated-*`.

**Architectural notes to enforce:**

- All four follow the identical file shape as Greenhouse/Lever: schema at top, mapping function, class implementing `ScrapeSource`. A reader who has seen one adapter has seen all six — uniformity _is_ the maintainability feature.
- Pagination logic stays _inside_ each adapter (Workday offset, SmartRecruiters offset) — `ScrapeSource.fetchPostings` returns the complete list; the pipeline never knows pagination exists. If a third offset-paginated ATS ever appears, extract a shared helper _then_, not now (rule of three).
- Live verification is part of the definition of done, per §14 M1: 2–3 real companies per adapter, endpoint shapes adjusted to reality if drifted, and each drift documented in a comment citing the company it was verified against.

**Acceptance criteria:**

- Fixture tests per adapter (recorded live JSON): correct `RawPosting[]`; missing-required-field fixture throws `AdapterError`; extra-fields fixture passes
- Workday: multi-page fixture sequence (2 pages + empty terminator) yields the concatenated list; malformed slug throws before any HTTP call; page cap triggers cleanly on a synthetic infinite fixture
- Slug codec round-trips; decode of `"garbage"` throws
- Live: `employed company add` + `scan` verified against 2–3 real companies per ATS, health flips to `ok`, yields recorded
- SmartRecruiters and Workday jobs land with `description: null` and score later without error (spot-check a row)
- Suite passes offline; live checks behind the env flag

## Layer 3, Unit 2: First ATS Adapters (Greenhouse + Lever) + Canonical Job Shape + Smoke Test

**What this is:** The first unit that produces actual job data. Two deliberately-chosen adapters — Greenhouse and Lever are the simplest APIs and the highest-coverage — plus the **adapter contract** and the **canonical Job normalization** that all future adapters (and the Tier-2/3 generated scrapers) will flow through. Getting the contract right here means the remaining four adapters are ~60-line mechanical additions.

---

**Deliverables:**

**`src/scrape/types.ts` — the scraping domain contracts:**

```typescript
// What every source (ATS adapter OR generated scraper) emits — the pre-normalization shape
export interface RawPosting {
  title: string;
  url: string;
  location?: string | null;
  department?: string | null;
  description?: string | null; // ATS APIs provide it; generated scrapers may not
  externalId?: string | null; // ATS-native ID when available — preferred dedupe key
}

export interface ScrapeSource {
  readonly method: ScrapeMethod;
  fetchPostings(company: CompanyRow): Promise<RawPosting[]>;
}
```

`ScrapeSource` is the unifying abstraction: ATS adapters implement it now, `generated.ts` (Tier 2/3 executor) implements it later, and the scan pipeline only ever sees this interface. This is the single most important boundary in the scraping layer.

**`src/scrape/adapters/greenhouse.ts` — `GreenhouseAdapter implements ScrapeSource`:**

Calls `GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true` via the `HttpClient` (constructor-injected, same as detection). Parse JSON defensively: validate the response envelope with a **lenient zod schema** — `{ jobs: z.array(z.object({...}).passthrough()) }` with only the fields we consume required (`title`, `absolute_url`, `id`) and everything else optional. The endpoint-drift warning from the spec (§7.2) is handled by this pattern: unknown extra fields never break us; missing _required_ fields fail loudly with an `AdapterError` naming the field. Map: `title`→title, `absolute_url`→url, `location.name`→location, first of `departments[].name`→department, `content` (HTML)→description, `id`→externalId. Strip HTML tags from `content` to plain text (simple regex-based tag strip in `src/util/html.ts` — cheerio is overkill for this and isn't a dependency yet).

**`src/scrape/adapters/lever.ts` — `LeverAdapter implements ScrapeSource`:**

`GET https://api.lever.co/v0/postings/<slug>?mode=json` — response is a bare array. Map: `text`→title, `hostedUrl`→url, `categories.location`→location, `categories.team`→department, `descriptionPlain` (fall back to tag-stripped `description`)→description, `id`→externalId. Same lenient-zod discipline.

**`src/scrape/adapters/index.ts` — adapter registry:**

```typescript
export function getSource(
  method: ScrapeMethod,
  deps: { http: HttpClient },
): ScrapeSource | null;
```

A map, not a switch-in-business-logic: `{ greenhouse: ..., lever: ... }`, returns `null` for methods without a source yet (`unknown`, `manual`, not-yet-built ATSes). The scan pipeline asks the registry; adding adapters later touches only this file + the new adapter file.

**`src/scrape/normalize.ts` — pure functions, the §5 contract:**

```typescript
export function normalizeTitle(title: string): string;
// lowercase → strip req-IDs /\(?(req|id|r-)[:# ]?\w+\)?/gi → collapse whitespace → trim

export function computeDedupeKey(p: RawPosting): string;
// externalId ?? sha256(normalizeTitle(title) + urlPath(url))

export function toJobInput(
  p: RawPosting,
  companyId: number,
  today: string,
): JobInsertInput;
// trims fields, resolves absolute URL, attaches dedupe_key, first_seen/last_seen = today
```

This module is where the dedupe key _computation_ lives — the boundary we explicitly reserved in Layer 2 Unit 1 (repository enforces uniqueness; this owns the math). Fully unit-tested: req-ID stripping variants, externalId-vs-hash paths, hash stability.

**`src/services/scrape.ts` — `ScrapeService` (first slice):**

```typescript
class ScrapeService {
  constructor(
    private repos: Repositories,
    private http: HttpClient,
  ) {}
  async scrapeCompany(company: CompanyRow): Promise<CompanyScrapeResult>;
  async smokeTest(company: CompanyRow): Promise<SmokeResult>;
}
```

`scrapeCompany`: registry lookup → `fetchPostings` → normalize each → `withTransaction`: upsert all → return `{ seen, new, method }`. On source `null`: return a typed `skipped` result (not an error). On adapter throw: catch, `repos.companies.recordFailure()`, return a `failed` result with the message — the §12 rule (one company never aborts anything) is enforced _here_, at the service seam, once, for every current and future caller.

`smokeTest`: run `fetchPostings`, and on ≥1 posting with valid title+URL: `recordSuccess(id, count)` + `updateHealth('ok')`; on zero or error: leave health as-is, return the reason. **Wire this into detection's tail:** `CompanyService.add` now runs detect → (if method has a registered source) smokeTest — completing the §7.2 step-3 behavior that was deferred. This _does_ change `CompanyService` (by design this time): it gains a `ScrapeService` constructor dependency.

**`src/commands/scan.ts` — `employed scan [--company <name>]`:**

Single-company mode only in this unit (`--company` required; the all-companies tier-aware loop belongs to the `run` orchestration unit with politeness). Spinner during fetch → summary line: `✓ Stripe (greenhouse): 42 seen, 3 new` → table of new jobs (title, location, URL). Not-found company and no-source-yet company each get clean, distinct messages.

**Acceptance criteria:**

- Recorded-JSON fixture tests for both adapters: real captured API responses parse to correct `RawPosting[]`; a fixture with a missing required field throws `AdapterError` naming it; a fixture with extra unknown fields passes
- Normalize tests: `"Software Engineer (Req #12345)"` and `"software engineer"` produce identical dedupe keys; same posting with `externalId` uses it verbatim
- Live: `employed company add` for one real Greenhouse and one real Lever company detects, smoke-tests, and flips health to `ok` with yield recorded; `employed company list` shows it
- `employed scan --company Stripe` twice: first run N new, second run 0 new, N seen (dedupe proven end-to-end)
- Adapter throw path: a company whose slug is garbage records a failure, increments `consecutive_failures`, exits 0 with a failed-result line
- Full suite passes offline

---

Say **next** for Layer 3, Unit 3: the remaining four adapters (Ashby, Workday, SmartRecruiters, Recruitee) — including Workday's POST pagination.

## Layer 3, Unit 1: Real ATS Detection — Signature Matching

**What this is:** Replacing `StubDetector` with the real thing — the component that decides _how_ each company gets scraped. The architectural core of this unit: split detection into a **pure signature matcher** (string/DOM analysis, zero I/O, exhaustively testable on fixtures) and a thin **fetching shell** around it. Adapters and smoke tests come in the next units — this unit answers "which ATS is this?" and nothing more.

---

**Deliverables:**

**`src/util/http.ts` — minimal HTTP client abstraction:**

```typescript
export interface HttpClient {
  fetchText(url: string, opts?: { timeoutMs?: number }): Promise<FetchResult>;
}
export interface FetchResult {
  finalUrl: string;      // after redirects — detection depends on this
  status: number;
  body: string;
  contentType: string | null;
}
export class UndiciHttpClient implements HttpClient { ... }
```

Built on Node's built-in `fetch` (undici). Follows redirects (default behavior — but capture `response.url` as `finalUrl`, this is load-bearing: many careers pages redirect straight to `boards.greenhouse.io/...`). Sets the honest UA from the spec: `employed/1.0 (+personal job search tool)` — put the UA string in `constants.ts`. Default timeout 15s via `AbortSignal.timeout`. Non-2xx returns the result (caller decides) rather than throwing; network/timeout errors throw a typed `HttpError extends AppError`. **No politeness logic here** (rate limiting, robots.txt are a dedicated Layer 3 unit) — but every future fetch in the app goes through this interface, so politeness later becomes a decorator wrapping `HttpClient`, touching nothing else. That's the reason this abstraction exists.

**`src/scrape/signatures.ts` — the pure matcher (heart of the unit):**

```typescript
export interface SignatureMatch {
  method: ScrapeMethod; // 'greenhouse' | 'lever' | ...
  slug: string;
  detail: string; // which signature fired, for logs/doctor
}
export function matchSignatures(
  finalUrl: string,
  html: string,
): SignatureMatch | null;
```

Implementation: an ordered array of `SignatureRule` objects — `{ method, urlPatterns: RegExp[], htmlPatterns: RegExp[], extractSlug(url, html): string | null }` — evaluated in the spec's §7.2 order (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Recruitee). First match wins. Adding ATS #7 later = appending one rule object, no logic changes.

Slug extraction per ATS (each rule owns its own extractor):

- **Greenhouse:** slug from `boards.greenhouse.io/<slug>` in final URL _or_ from embedded `grnhse`/`boards.greenhouse.io` script/iframe src in HTML
- **Lever:** `jobs.lever.co/<slug>`
- **Ashby:** `jobs.ashbyhq.com/<slug>`
- **Workday:** composite — capture `tenant`, `wd<N>` instance, and `site` from `<tenant>.wd<N>.myworkdayjobs.com/<site>`; store as a single slug string `tenant|wdN|site` (document this encoding in a comment — the Workday adapter unit will parse it back out; keeps the DB schema's single `slug` column sufficient)
- **SmartRecruiters:** `careers.smartrecruiters.com/<Company>`
- **Recruitee:** `<slug>.recruitee.com`

Check both the final URL _and_ the HTML body for every rule — a company page that embeds Greenhouse via iframe never redirects, so URL-only matching would miss the majority of Tier-1 candidates.

**`src/scrape/detect.ts` — `SignatureDetector implements AtsDetector`:**

Flow: `http.fetchText(careersUrl)` → on HTTP error or non-2xx, return `{ method: 'unknown', slug: null, detail: 'fetch failed: <reason>' }` (detection failure is _data_, not an exception — the company stays usable, `doctor` surfaces it) → `matchSignatures(finalUrl, body)` → return match or unknown-with-detail. Constructor takes `HttpClient` (DI — tests inject a fake returning fixture HTML, zero network in the suite).

Delete `StubDetector`; wire `SignatureDetector` in cli.ts where the stub was constructed. Per the seam design from Layer 2 Unit 2, `CompanyService` doesn't change by a single line — verify this holds; if it doesn't, the seam was wrong and this is the moment to fix it.

**Health semantics this unit:** on successful detection, method+slug are persisted but health remains `'untested'` — health flips to `'ok'` only after an adapter smoke test succeeds, which is next unit's job. Update the `company add` success output to show the detected method (e.g. `✓ Stripe — detected: greenhouse (slug: stripe)`).

**Fixtures (`test/fixtures/detection/`):** one saved HTML file + expected result per ATS (grab real pages for e.g. a Greenhouse-embedded company, a Lever company, etc. during the build), plus a custom-page fixture that must yield `unknown` and a redirect case verifying `finalUrl`-based matching. The matcher test table runs entirely on these.

**Acceptance criteria:**

- `matchSignatures` unit tests: all 6 ATSes detected from fixtures with correct slugs (including the Workday composite), custom page → `null`, URL-based and HTML-embed-based Greenhouse both detected
- `employed company add` against 2–3 real companies live-detects the right method and prints it; a custom-careers-page company adds cleanly as `unknown`
- Unreachable URL: company is still created, method `unknown`, detail contains the fetch failure, exit code 0
- `CompanyService` has a zero-line diff
- Test suite passes with network disabled (fake `HttpClient` everywhere except an optional live smoke test behind an env flag)

## Layer 2, Unit 2: Company Registry — employed company add | list + employed import

What this is: The first feature-complete vertical slice: user input → service logic → repository → rendered output. It also establishes two patterns the rest of the app lives on: the service layer (commands stay thin) and interface-first stubbing (detection is defined as a contract now, implemented in Layer 3 — so this unit ships without any network code).

Deliverables:
New dependency: cli-table3.
UI layer extension (src/ui/) — Add to the UI interface: table(headers: string[], rows: string[][]): void. AnimatedUI renders via cli-table3 with chalk-styled headers and color-coded health cells (ok green, degraded yellow, broken red, untested dim); PlainUI renders aligned plain columns (pipe-to-file safe). Health→color mapping lives in one exported function in the UI layer — the report and doctor units will reuse it.
src/scrape/detect.ts — contract only, no implementation:
typescriptexport interface DetectionResult {
method: ScrapeMethod; // from @/db types
slug: string | null;
detail: string | null; // e.g. matched signature, for logging
}
export interface AtsDetector {
detect(careersUrl: string): Promise<DetectionResult>;
}
export class StubDetector implements AtsDetector {
async detect(): Promise<DetectionResult> {
return { method: 'unknown', slug: null, detail: 'detection not yet implemented' };
}
}
This is the seam Layer 3 plugs into. CompanyService depends on the interface, never the class — when the real detector lands, zero service code changes. (Same pattern the AI runner will use for the Claude/Codex/ChatGPT providers.)
src/services/company.ts — CompanyService (new services/ directory; this is where all business logic lives from now on):
typescriptclass CompanyService {
constructor(private repos: Repositories, private detector: AtsDetector) {}
async add(input: { name: string; url: string; tier?: Tier }): Promise<AddResult>;
async importFromConfig(companies: CompaniesFile): Promise<ImportSummary>;
list(): CompanyRow[];
}
add() rules: normalize the URL (require http/https, throw a typed ValidationError otherwise — rendered by the error boundary, never a stack trace); reject duplicate names case-insensitively (AddResult distinguishes created vs duplicate — import needs this); insert; run detector.detect(); persist method/slug via repos.companies.updateMethod(). Health stays untested when method is unknown (the stub path today; the real detector's smoke test flips it to ok in Layer 3).
importFromConfig(): iterate entries, apply the file's defaults.tier, call add() per entry, collect { created, skipped, failed } counts with per-failure reasons. One bad entry never aborts the batch — the §12 "single failure never aborts the run" rule starts here.
src/commands/company.ts — Commander sub-command group:

employed company add <name> --url <url> [--tier A|B|C] — spinner through add→detect, success line showing the detected method (today: "method: unknown — will be detected in a future update" phrasing comes from the command, not the service; services return data, commands own wording).
employed company list — renders the health table: Name, Tier, Method, Health, Last Yield, Last Success (relative time, e.g. "2d ago" — put relativeTime() in src/util/time.ts, the report unit reuses it). Empty state: friendly hint to run company add or import.

src/commands/import.ts — employed import [file] (defaults to ~/.employed/companies.yaml): load through ConfigService (custom path support means loadCompanies(path?) gains an optional arg), per-company spinner line as the batch progresses, final summary block: created / skipped-duplicate / failed counts. Idempotent by construction — rerunning imports skips everything.
Wiring: CommandContext grows to { ui, config, db, repos } (repos constructed once in cli.ts). Services are constructed inside commands from ctx pieces — ctx carries capabilities, not every service instance, which keeps the context from becoming a god object as services multiply.
Architectural decisions to enforce:

Services return structured results; commands translate to prose. AddResult/ImportSummary are data. This is what makes a future --json flag (already in the spec for new) a command-layer-only change.
Typed error hierarchy starts now: src/util/errors.ts with AppError base (ValidationError, ConfigError moves under it). Error boundary in cli.ts renders AppErrors as clean messages, unknown errors with stack (dev signal vs. user signal).
Case-insensitive duplicate check happens in SQL (WHERE name = ? COLLATE NOCASE), not by loading all rows — repositories do set logic in the database, always.

Acceptance criteria:

add inserts, shows method unknown, health untested; adding "stripe" after "Stripe" reports duplicate without inserting
add with --url ftp://x or a garbage URL exits with a clean validation message
list renders the table with real data and colors in TTY; list | cat is plain and aligned
import on the template's example file creates all entries; immediate rerun reports 100% skipped, 0 created
A companies.yaml with one malformed entry imports the rest and reports the one failure by name
Service tests run entirely on :memory: DB + StubDetector — no network, no filesystem

## Layer 2, Unit 1: SQLite Layer — Schema, Migrations, Typed Data Access

**What this is:** The persistence foundation. Every feature after this reads or writes the database, so the pattern here — repository classes over raw SQL, migrations from day one — determines whether adding/removing features later is a file-level change or surgery across the codebase.

---

**Deliverables:**

**New dependency:** `better-sqlite3` (+ `@types/better-sqlite3`).

**`src/db/schema.sql`** — The full schema from the spec (§6), verbatim: `companies`, `jobs`, `applications`, `events`, `email_threads`, `runs`, `claude_cache` — with one rename given the provider-flexibility direction: call the cache table `ai_cache` now (columns identical). All seven tables ship in migration 1 even though early units only touch `companies` and `jobs` — schema churn is more expensive than unused tables, and the spec's schema is settled.

**`src/db/migrate.ts`** — A minimal, forward-only migration runner using SQLite's `user_version` pragma:

```typescript
const migrations: Migration[] = [
  { version: 1, up: (db) => db.exec(readFileSync(SCHEMA_SQL_PATH, "utf8")) },
  // future: { version: 2, up: (db) => db.exec("ALTER TABLE ...") }
];
export function migrate(db: Database): void; // runs pending migrations in a transaction each
```

Rules: each migration runs inside a transaction; `user_version` is bumped only on success; the runner is idempotent (safe to call on every startup, which is exactly what we'll do). No down-migrations — for a local single-user app, rollback is "restore the file," and down-migrations are maintenance burden that rots.

**`src/db/connection.ts`** — A `createDb(path?)` factory: opens the file (defaulting to `DB_PATH` from constants, injectable path for tests — `:memory:` makes the entire test suite need zero disk), sets pragmas (`journal_mode = WAL`, `foreign_keys = ON` — better-sqlite3 does _not_ enable FK enforcement by default, and our schema depends on it), then calls `migrate()`. One connection per process, created in cli.ts, added to `CommandContext`.

**`src/db/types.ts`** — Row types for every table (`CompanyRow`, `JobRow`, ...) plus the enums as string-literal unions (`Tier = 'A'|'B'|'C'`, `ScrapeMethod`, `Health`, `JobStatus`, `AppStatus`, `EventType`, `Band`). These are the _canonical domain types_ for the whole app — the scraper, scorer, and report units all import from here. One place, one truth.

**`src/db/repositories/`** — The data-access pattern, one repository class per aggregate:

```
repositories/
  companies.ts    # CompanyRepository
  jobs.ts         # JobRepository
  index.ts        # Repositories bundle: { companies, jobs } — grows per unit
```

Only these two repositories are implemented now (they're what Units 3+ need); `applications`, `runs`, etc. get their repositories in the units that use them — the _pattern_ is established here, the coverage grows just-in-time.

Each repository: constructor takes the `Database`, prepares its statements once (better-sqlite3's prepared statements are the performance model — prepare in constructor, run in methods), exposes intent-named methods, and **is the only place SQL strings exist** for its tables. Commands and services never see SQL.

`CompanyRepository`: `insert(input): CompanyRow`, `findByName`, `list()`, `updateMethod(id, method, slug?, config?)`, `updateHealth(id, health)`, `recordSuccess(id, yieldCount)`, `recordFailure(id)` (increments `consecutive_failures`).

`JobRepository`: `upsert(input): { job: JobRow, isNew: boolean }` — implements the §5 dedupe contract in one place: `INSERT ... ON CONFLICT(company_id, dedupe_key) DO UPDATE SET last_seen = excluded.last_seen`, with `isNew` derived from whether the insert took. Also `findNewSince(date)`, `markClosedIfUnseen(companyId, runDate)` (the 2-consecutive-runs lifecycle rule lands in the scrape unit — stub the signature now), `dismiss(id)`.

**`src/db/index.ts`** — Public surface of the whole layer: `createDb`, `Repositories`, row types. The rest of the app imports `@/db` and nothing deeper — internal file layout stays refactorable.

**Architectural decisions to enforce:**

- **Repository owns SQL; service owns rules; command owns orchestration.** The dedupe key _computation_ (`sha256(normalizedTitle + urlPath)`) does NOT live in the repository — that's domain logic and belongs to the normalize unit later. The repository receives a computed `dedupe_key` and enforces uniqueness. Keep this boundary crisp.
- **Everything injectable.** `createDb(':memory:')` + `new Repositories(db)` must fully wire the persistence layer in a test with no filesystem. This is the payoff of the factory/DI discipline from Units 1–2.
- **Transactions at the service layer**, not inside repositories — a future scrape run wraps "upsert 200 jobs" in one transaction spanning repository calls. Expose `withTransaction<T>(fn): T` from `connection.ts` (wrapping better-sqlite3's `db.transaction`) so services can do this without touching the driver.

**Acceptance criteria:**

- `employed init` now also creates and migrates the DB (extend init's step list); running init twice is still idempotent, `user_version` stays 1
- Fresh DB has all 7 tables, `foreign_keys` pragma ON, WAL mode active
- `CompanyRepository.insert` + `findByName` round-trip on `:memory:`
- `JobRepository.upsert` called twice with the same `(company_id, dedupe_key)` returns `isNew: true` then `isNew: false`, and `last_seen` updates while `first_seen` doesn't
- Inserting a job with a nonexistent `company_id` throws (proves FK enforcement)
- A deliberately failing migration in a test leaves `user_version` unbumped and the DB unchanged (transaction rollback proven)

## Layer 1, Unit 2: Config System + `employed init`

**What this is:** The configuration foundation and the first real command. Every future unit reads config — so the pattern established here (schema-validated, typed, single source of truth) is what keeps the app maintainable when there are 15 commands all needing settings. `init` is also the first consumer of the command-registration pattern from Unit 1, proving it works.

---

**Deliverables:**

**New dependencies:** `zod`, `yaml` (the `yaml` package, not `js-yaml` — better TS types and comment preservation).

**`src/config/schema.ts`** — Zod schemas as the single source of truth for every config file. Types are _derived_ from schemas (`z.infer`), never hand-written in parallel — one definition, validation and types both come from it:

```typescript
export const AppConfigSchema = z.object({
  run: z
    .object({
      time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .default("07:00"),
      concurrency: z.number().int().min(1).max(10).default(4),
    })
    .default({}),
  email: z
    .object({
      enabled: z.boolean().default(false),
      // smtp fields land in the email unit — schema is extended then, not rewritten
    })
    .default({}),
  claude: z
    .object({
      enabled: z.boolean().default(true),
      maxCallsPerRun: z.number().int().default(10),
    })
    .default({}),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
```

Same file: `CompaniesFileSchema` (defaults block + array of `{name, url, tier?}`) and `KeywordsFileSchema` (`title`/`desc`/`negative` as `Record<string, number>`). Every field has a `.default()` — a valid empty file must parse into a fully-populated config object. This is the "defaults live in the schema, nowhere else" rule; no scattered `?? fallback` logic anywhere downstream.

**`src/config/loader.ts`** — A `ConfigService` class (constructor takes a base dir, defaulting to `EMPLOYED_DIR` — injectable for tests):

```typescript
class ConfigService {
  loadApp(): AppConfig;
  loadCompanies(): CompaniesFile;
  loadKeywords(): KeywordsFile;
}
```

Each method: read file → parse YAML → zod validate → return typed object. On validation failure, throw a custom `ConfigError` that includes the file path and a human-readable list of which fields failed and why (map zod issues to `path: message` lines) — the error boundary from Unit 1 renders it. Lazy + memoized per process: parse once, cache the result. Missing file throws `ConfigError` with a hint to run `employed init`.

**`src/config/templates.ts`** — The default file contents `init` writes, as exported string constants. Templates are _commented YAML_ (this is why we chose the `yaml` package) — the companies template shows two example entries commented out, the keywords template ships the full seed profile from the spec (§7.6 values), the config template shows every option with its default and a comment explaining it. The user's first-run experience is editing a self-documenting file.

**`src/commands/init.ts`** — First real command, implementing the `register(program)` interface:

Flow: banner → check if `~/.employed` exists (if fully initialized, say so and exit 0 — idempotent, never clobber user edits) → create directory tree (`reports/`, `logs/`) → write the three template files _only if each is absent_ (per-file check, so a partial init recovers) → validate what was written by immediately loading it through `ConfigService` (proves templates and schemas agree — this catches template/schema drift at dev time, a classic silent-rot bug) → success summary listing what was created vs. skipped.

Each step gets a `ui.spinner()` — this is the first place the animation layer shows off: spinner per step, succeed/fail per step, plain fallback automatic.

**Architectural decisions to enforce:**

- **Commands orchestrate; services do work.** `init.ts` should read as a sequence of calls into `ConfigService` + a small `scaffold` helper — zero YAML parsing, zero schema knowledge inline. This is the layering every future command follows: thin command → fat service.
- **Schema evolution path:** future units _extend_ these zod schemas (`.extend()`, adding optional fields with defaults). Because every field defaults, old config files remain valid as the app grows — forward compatibility by construction, no migration system needed for config (the DB gets migrations; config doesn't need them).
- `ConfigService` is instantiated once in cli.ts alongside the UI and passed to commands (same DI pattern as `ui`). Define a `CommandContext { ui, config }` type in `commands/types.ts` and update the register signature to `register(program: Command, ctx: CommandContext)` — this context object is how every future dependency (db, later) reaches commands without global imports.

**Acceptance criteria:**

- `employed init` on a clean machine creates the full tree + three files, each step animated
- Running it again reports "already initialized," changes nothing (verify by mtime)
- Deleting only `keywords.yaml` and re-running restores just that file
- Hand-corrupting a yaml value (e.g. `concurrency: banana`) and loading produces a `ConfigError` naming the file, the field path, and the expected type — rendered cleanly, not a stack trace
- An empty `config.yaml` parses into the full default object
- Templates round-trip: every generated template passes its own schema

---

Say **next** for Layer 1, Unit 3: the SQLite layer — schema, migrations, and the typed data-access pattern.

## Layer 1, Unit 1: Project Scaffold + CLI Entry Point

**What this is:** The skeleton that every future unit plugs into. No features — just the build system, project structure, and a working `employed` command that does nothing except prove the toolchain works. Since you want animations throughout, we're also establishing the UI abstraction layer _now_ — this is a foundational decision, because if animation calls get scattered inline across 20 command files, you'll never be able to change the visual style, add a `--quiet` flag, or make cron runs animation-free without touching everything.

---

**Deliverables:**

**`package.json`** — TypeScript project with `"bin": { "employed": "dist/cli.js" }`. Package name `employed`. Scripts for `build` (tsc), `dev` (tsx for local iteration), and `lint`. Target ES2022, module NodeNext. Dependencies: `commander`, `chalk`, `ora` (spinners), `nanospinner` optional alternative — pick `ora`, it's the standard. Dev dependencies: `typescript`, `tsx`, `@types/node`. Nothing else yet.

**`tsconfig.json`** — Strict mode on, `outDir: dist`, `rootDir: src`, `declaration: true`. Path alias `@/*` mapped to `src/*` so imports stay clean as the tree grows (`@/db`, `@/ui`, `@/util` — never `../../../../db`).

**`src/cli.ts`** — The single entry point. `#!/usr/bin/env node` shebang. Creates a `commander.Command` instance, sets name/version/description, registers a global `--no-animation` flag, and calls `program.parse()`. No subcommands yet. Top-level error boundary that catches, prints a styled error via the UI layer (not raw chalk), and exits with code 1.

**`src/ui/index.ts` — the UI abstraction layer (the important new piece):**

A single module that owns _all_ terminal output for the entire application. Commands never import `ora` or `chalk` directly — they import `ui`. Interface to define now:

```typescript
interface UI {
  spinner(text: string): Spinner; // start/succeed/fail/update
  success(msg: string): void; // ✓ styled
  error(msg: string): void; // ✗ styled
  warn(msg: string): void;
  info(msg: string): void;
  heading(msg: string): void; // section headers
  banner(): void; // "employed" ASCII/gradient banner on startup
}
```

Two implementations behind a factory: `AnimatedUI` (ora spinners, banner, color) and `PlainUI` (plain line output — used when `--no-animation` is passed, when `!process.stdout.isTTY`, or when `CI`/cron is detected). The factory checks TTY automatically — this matters because your daily scheduled run will pipe to a log file, and animated spinner frames in a log file are garbage. This TTY-detection decision made now saves a painful refactor later.

The `banner()` for this unit can be simple (name + version with chalk styling); a fancier gradient/ASCII treatment is a later polish unit — but the _call site_ exists from day one.

**Directory structure created (empty directories with `.gitkeep`):**

```
src/
  commands/       # one file per command, registered by cli.ts
  ui/             # ALL terminal output lives here
  db/             # schema + data access layer
  scrape/         # adapters, detection, generation
  score/          # scoring engine
  gmail/          # sync logic
  claude/         # runner + prompt management
  report/         # digest/report generation
  config/         # yaml parsing + validation
  util/           # shared helpers
prompts/          # prompt template .txt files
```

**Architectural decisions to enforce:**

Each `commands/` file will export a single function `register(program: Command): void` — cli.ts imports and calls each one. Adding a command never touches cli.ts internals after the registration pattern is wired. Define this interface now in `src/commands/types.ts` even though no commands exist yet.

A `src/constants.ts` defining `EMPLOYED_DIR = path.join(os.homedir(), '.employed')` and all derived paths (`DB_PATH`, `CONFIG_PATH`, `REPORTS_DIR`, `LOGS_DIR`) as constants. Every future module imports paths from here — never constructs them inline.

The UI instance is created once in cli.ts and passed down (or exposed as a singleton via `getUI()`) — commands receive it, they don't construct it. This is dependency inversion: swap `AnimatedUI` for `PlainUI` (or a future test-mock UI) and zero command code changes.

**Acceptance criteria:**

- `npm run build` compiles with zero errors, zero warnings
- `npm link` installs globally; `employed --help` prints name, version, description
- `employed --version` works
- Running `employed` in a TTY shows the banner via `AnimatedUI`
- `employed --no-animation` and `employed | cat` both produce plain output (proving TTY detection works)
- The error boundary catches a thrown error, renders it through `ui.error()`, exits code 1
- Path aliases resolve in both `tsc` and `tsx`
