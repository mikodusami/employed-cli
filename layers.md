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
