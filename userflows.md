## Layer 1, Unit 1 — Project scaffold and CLI entry point

Run these flows from the repository root after `npm install` and `npm run build`.

## Isolated-state protocol (applies to every user flow)

Each numbered flow is independent: do not carry its companies, jobs, configuration edits, or database
into the next flow. Before its first command, run:

```bash
export EMPLOYED_DIR="$(mktemp -d)"
employed init --no-animation
```

This creates an empty, disposable Employed workspace. After the flow's assertions, run:

```bash
rm -rf "$EMPLOYED_DIR"
unset EMPLOYED_DIR
```

The cleanup removes only the directory created for that flow and prevents its location from leaking
into later shell commands. For a flow with prerequisite data, create that data within the same flow;
do not assume a preceding flow has run.

### Flow 1: Discover the CLI

1. Run `employed --help`.
2. Confirm the heading is `Usage: employed [options]`.
3. Confirm the description and the `--version`, `--no-animation`, and `--help` options appear.

### Flow 2: Check the installed version

1. Run `employed --version`.
2. Confirm the only output is `0.1.0`.

### Flow 3: Start interactively

1. Run `employed` in an interactive terminal.
2. Confirm the styled `employed v0.1.0` banner appears.
3. Confirm the command exits successfully.

### Flow 4: Disable animation explicitly

1. Run `employed --no-animation`.
2. Confirm the plain `employed v0.1.0` banner appears without animated terminal frames.

### Flow 5: Redirect output for automation

1. Run `employed | cat`.
2. Confirm the output is a clean `employed v0.1.0` line with no spinner control characters.

### Flow 6: Exercise the development entry point

1. Run `npm run dev -- --version`.
2. Confirm the TypeScript source runs directly and prints `0.1.0`.

### Flow 7: Link the command locally

1. Run `npm link` (use a user-writable npm prefix if the global npm directory is protected).
2. Run `employed --help`.
3. Confirm the installed command shows the same help text as Flow 1.

## Layer 2 — Configuration and SQLite persistence

Run these flows after `npm run build`; the isolated-state protocol supplies a fresh `EMPLOYED_DIR`.

### Flow 1: Initialize a fresh workspace

1. Run `employed init --no-animation`.
2. Confirm the command reports valid configuration and database schema version 1.
3. Confirm `$EMPLOYED_DIR` contains `config.yaml`, `companies.yaml`, `known_ats.yaml`,
   `keywords.yaml`, `employed.db`, `reports/`, and `logs/`.
4. Open the YAML files and confirm their comments explain the available settings.
5. Confirm `keywords.yaml` includes `new grad: 6`, `machine learning: 2`, and
   `phd required: 6` in their respective title, description, and negative lists.
6. Confirm `config.yaml` enables AI globally, enables both Claude and Codex, and lists
   `[claude, codex]` as the provider preference order.
7. Change the preference to `[codex, claude]`, disable either provider, and run
   `employed init --no-animation`; confirm the edited valid configuration is preserved.

### Flow 2: Prove initialization is idempotent

1. Add a comment to `$EMPLOYED_DIR/config.yaml`.
2. Run `employed init --no-animation` again.
3. Confirm it says the workspace is already initialized and no files were changed.
4. Confirm your added comment is still present.

### Flow 3: Recover a partially initialized workspace

1. Move one generated YAML file out of `$EMPLOYED_DIR` temporarily.
2. Run `employed init --no-animation`.
3. Confirm only the missing file is recreated and the other three are reported as preserved.
4. Restore your original file if it contained edits you want to keep.

### Flow 4: See an actionable validation error

1. Set `run.concurrency` to `99` in `$EMPLOYED_DIR/config.yaml`.
2. Run `employed init --no-animation`.
3. Confirm the error names `config.yaml`, identifies `run.concurrency`, and exits unsuccessfully.
4. Restore concurrency to a value from 1 through 10 and rerun init successfully.

### Flow 5: Run the automated persistence contract

1. Run `npm test`.
2. Confirm all configuration and SQLite tests pass, including migration rollback, foreign-key
   enforcement, WAL mode, deduplication, memoization, and transaction rollback.

### Flow 6: Reinitialize a pre-reconciliation development database

This flow applies only if you ran Layer 2 before the authoritative §6 schema was supplied.

1. Back up `$EMPLOYED_DIR/employed.db` if it contains data you want to inspect later.
2. Move the old database outside `$EMPLOYED_DIR`.
3. Run `employed init --no-animation`.
4. Confirm a new database is created at schema version 1.
5. Run `npm test` and confirm all eleven persistence and configuration checks pass.

## Layer 2, Unit 2 — Company registry and import

Run `npm run build`; then use the isolated-state protocol before each flow.

### Flow 1: Add and detect a company

1. Run `employed company add "Stripe" --url https://stripe.com/jobs --tier A --no-animation`.
2. Confirm Stripe is added with `method: unknown` and the future-detection message.
3. Run `employed company list --no-animation`.
4. Confirm Stripe shows tier A, method unknown, health untested, and empty last-yield/success values.

### Flow 2: Verify case-insensitive duplicate protection

1. Add Stripe with `employed company add "Stripe" --url https://stripe.com/jobs --tier A --no-animation`.
2. Run `employed company add "stripe" --url https://example.com/jobs --no-animation`.
3. Confirm it reports Stripe is already registered and makes no changes.
4. Run `employed company list --no-animation` and confirm only one Stripe row exists.

### Flow 3: See clean URL validation

1. Run `employed company add "Bad URL" --url ftp://example.com/jobs --no-animation`.
2. Confirm the command exits unsuccessfully with `Careers URL must use http or https.`
3. Confirm no stack trace is displayed and Bad URL does not appear in the company list.

### Flow 4: Inspect automation-safe table output

1. Add Stripe with `employed company add "Stripe" --url https://stripe.com/jobs --tier A --no-animation`.
2. Run `employed company list | cat`.
3. Confirm columns remain aligned and no color or spinner control characters appear.

### Flow 5: Import a company file idempotently

1. Add two valid entries to `$EMPLOYED_DIR/companies.yaml` and run
   `employed import --no-animation`.
2. Confirm the summary reports two created, zero skipped, and zero failed.
3. Run the same command again.
4. Confirm the summary reports zero created, two skipped-duplicate, and zero failed.

### Flow 6: Contain one malformed import entry

1. Add two valid entries and one entry whose URL is `ftp://example.com/jobs` to
   `$EMPLOYED_DIR/companies.yaml`.
2. Run `employed import --no-animation`.
3. Confirm the two valid entries are created, the malformed entry is reported as failed by name,
   and the command reaches its final summary.

### Flow 7: Run the no-network service contracts

1. Run `npm test`.
2. Confirm all 19 tests pass, including company add, duplicate, malformed URL, partial batch,
   custom config path, relative-time, and plain-table coverage.

## Layer 3, Unit 1 — Real ATS signature detection

### Flow 1: Detect Greenhouse from a live final URL

1. Run `employed company add "Anthropic" --url https://job-boards.greenhouse.io/anthropic`.
2. Confirm the success line reports `detected: greenhouse (slug: anthropic)`.
3. Run `employed company list` and confirm health remains untested.

### Flow 2: Detect additional live ATS providers

1. Add Linear from `https://jobs.ashbyhq.com/linear`.
2. Add Visa from `https://careers.smartrecruiters.com/Visa`.
3. Confirm the commands report Ashby slug `linear` and SmartRecruiters slug `Visa`.

### Flow 3: Preserve an unreachable company

1. Run
   `employed company add "Unreachable" --url https://not-a-real-host.invalid/careers`.
2. Confirm the command exits successfully and reports `detected: unknown` with fetch-failure detail.
3. Confirm the company list contains Unreachable with method unknown and health untested.

### Flow 4: Run the network-free detector suite

1. Run `npm test` with no live-test environment variable.
2. Confirm the six ATS fixtures, redirect matching, custom page, HTTP policy, and detector failure
   tests pass while the live smoke test is skipped.

### Flow 5: Run the optional live smoke test

1. Run `EMPLOYED_LIVE_ATS_TESTS=1 npm test` while connected to the internet.
2. Confirm the public Greenhouse, Ashby, and SmartRecruiters cases pass.
3. Treat future failures here as possible provider/site drift; the normal fixture suite must remain
   deterministic and network-free.

## Layer 3, Unit 2 — Greenhouse and Lever job adapters

### Flow 1: Smoke-test real adapters during company add

1. Add Anthropic from `https://job-boards.greenhouse.io/anthropic`.
2. Add Highspot from `https://jobs.lever.co/highspot`.
3. Run `employed company list`.
4. Confirm both companies show health `ok`, a nonzero last yield, and a recent last success.

### Flow 2: Scan and display new Lever jobs

1. Add Highspot from `https://jobs.lever.co/highspot`.
2. Run `employed scan --company Highspot --no-animation`.
3. Confirm the summary reports a nonzero seen count and the same number of new jobs.
4. Confirm the new-job table contains title, location, and URL columns.

### Flow 3: Prove end-to-end deduplication

1. Add Highspot from `https://jobs.lever.co/highspot`.
2. Run `employed scan --company Highspot --no-animation` once to establish the initial jobs.
3. Immediately run `employed scan --company Highspot --no-animation` again.
4. Confirm it reports the same seen count and `0 new`.
5. Confirm no new-job table is printed on the second run.

### Flow 4: Distinguish an unsupported source

1. Add Example from `https://example.com/careers`.
2. Confirm detection records its method as `unknown`.
3. Run `employed scan --company Example --no-animation`.
4. Confirm the command reports that Example was skipped because no source exists for `unknown`,
   rather than reporting an adapter failure.

### Flow 5: Verify contained adapter failures offline

1. Run `npm test`.
2. Confirm the garbage-slug adapter test returns a failed result, increments the company's failure
   count, and does not throw or abort the suite.
3. Confirm adapter fixtures, missing-field diagnostics, normalization, smoke health, transaction,
   and two-run deduplication tests all pass while live checks remain skipped.

### Flow 6: Run optional live adapter verification

1. Run `EMPLOYED_LIVE_ATS_TESTS=1 npm test` with internet access.
2. Confirm all fixture tests and opt-in public-board checks pass.
3. Remember that live job counts can change; assert nonzero yield and correct provider, not a fixed
   posting count.

## Layer 3, Unit 3 — Remaining Tier-1 ATS adapters

### Flow 1: Add and scan an Ashby board

1. Add Linear from `https://jobs.ashbyhq.com/linear`.
2. Confirm detection reports `ashby`, the smoke test marks health `ok`, and yield is nonzero.
3. Run `employed scan --company Linear --no-animation` and confirm jobs are stored and displayed.
4. Run the scan again and confirm it reports the same seen count and `0 new`.

### Flow 2: Add and scan a SmartRecruiters board

1. Add Visa from `https://careers.smartrecruiters.com/Visa`.
2. Confirm detection reports `smartrecruiters` and health becomes `ok`.
3. Run `employed scan --company Visa --no-animation`.
4. Confirm the scan succeeds with nonzero jobs; title and URL are populated even when descriptions
   are absent.

### Flow 3: Add and scan a Recruitee board

1. Add Freeday from `https://freeday.recruitee.com`.
2. Confirm detection reports `recruitee`, slug `freeday`, and health becomes `ok`.
3. Run `employed scan --company Freeday --no-animation`.
4. Confirm the new-job table contains Recruitee titles, locations, and public careers URLs.

### Flow 4: Add and scan a paginated Workday board

1. Add NVIDIA from `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`.
2. Confirm detection reports `workday`, slug `nvidia|wd5|NVIDIAExternalCareerSite`, and health `ok`.
3. Run `employed scan --company NVIDIA --no-animation`; allow time for bounded pagination.
4. Confirm the scan succeeds, every displayed URL contains `/NVIDIAExternalCareerSite/job/`, and
   descriptions are absent without causing an error.

### Flow 5: Verify the Workday pagination guards offline

1. Run `npm test` without `EMPLOYED_LIVE_ATS_TESTS` set.
2. Confirm the two-page-plus-empty-terminator test returns all three fixture jobs.
3. Confirm malformed slug validation performs zero HTTP calls and the infinite fixture stops at
   exactly 25 pages.
4. Confirm the live test is the only skipped test.

### Flow 6: Verify three public boards per new adapter

1. Run `EMPLOYED_LIVE_ATS_TESTS=1 npm test` while connected to the internet.
2. Confirm the opt-in test checks Linear, Notion, and Ramp (Ashby); Visa, Ubisoft, and Bosch
   (SmartRecruiters); Freeday, Polaroid, and Riverflex (Recruitee); and NVIDIA, Salesforce, and Citi
   (Workday).
3. Confirm all tests pass with zero skips; treat later failures as potential public-API drift.

## Layer 3, Unit 4 — Politeness and HTTP robustness

### Flow 1: Verify configuration and migration defaults

1. Open `$EMPLOYED_DIR/config.yaml` after initialization.
2. Confirm `run.jitterMs` is `500`–`1500`, `maxRetries` is `3`, and `respectRobots` is `true`.
3. Confirm initialization reports database schema version 2.
4. Run `employed --help` and confirm `--verbose` appears without changing the workspace.

### Flow 2: Observe a live conditional-cache hit

1. Add Anthropic from `https://job-boards.greenhouse.io/anthropic`; its smoke test establishes the
   cached Greenhouse response.
2. Run `employed --verbose scan --company Anthropic --no-animation`.
3. Confirm output includes `HTTP 304 cache hit` for the Greenhouse API and the scan succeeds.
4. Run the same verbose scan again and confirm it reports the same seen count and `0 new`.

### Flow 3: Confirm POST requests remain uncached

1. Add NVIDIA from `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`.
2. Run `employed --verbose scan --company NVIDIA --no-animation` twice.
3. Confirm both scans succeed and neither prints an HTTP cache-hit line for the Workday CXS endpoint.
4. Confirm the second scan reports `0 new`; deduplication still applies independently of HTTP cache.

### Flow 4: Verify robots rules and failure fallback offline

1. Run `npm test` without the live-test environment variable.
2. Confirm the robots fixture disallows `/jobs/private` and detection returns method `manual`.
3. Confirm the longer `/jobs/public` allow rule wins and a missing robots file permits detection.
4. Confirm the robots file is fetched only through the memoized gate.

### Flow 5: Verify retry boundaries without waiting

1. Run `npm test`.
2. Confirm the retry fixture returns `429`, `429`, then `200` and records backoffs of 1s and 2s.
3. Confirm a `404` makes exactly one request.
4. Confirm tests inject their clock/sleep seams and complete without real backoff delays.

### Flow 6: Verify polite scheduling and Workday delay removal

1. Run `npm test` and confirm the six-request scheduling fixture passes.
2. Confirm same-domain requests are FIFO with jitter at or above the configured minimum, two domains
   may overlap, and observed global concurrency never exceeds the configured cap.
3. Run `rg 'TODO\(politeness-unit\)|PAGE_DELAY_MS' src` and confirm it returns no matches.
4. Confirm Workday pagination tests still stop at 25 pages, now without adapter-owned sleeps.

## Layer 3, Unit 5 — Provider-agnostic AI runner

Run `npm run build` first. Start and finish **each** flow with the isolated-state protocol at the top
of this file; do not reuse a workspace between flows. These checks inspect provider CLIs but never
send a prompt or consume an AI call.

### Flow 1: Diagnose installed providers and the fresh database

1. Start a new temporary workspace and initialize it using the isolated-state protocol.
2. Run `employed doctor --no-animation`.
3. Confirm Claude and Codex each show enabled status and either an installed version or
   `binary not found on PATH`.
4. Confirm exactly one installed provider is marked active according to preference order; if neither
   binary is installed, confirm neither is active.
5. Confirm the database path begins with the current `$EMPLOYED_DIR`, schema version is `2`, table
   count is `8`, integrity is `ok`, and the command exits with status 0.
6. Remove the temporary workspace and unset `EMPLOYED_DIR` using the cleanup protocol.

### Flow 2: Change provider preference without crossing workspaces

1. Start and initialize a new temporary workspace.
2. In that workspace's `config.yaml`, reverse `ai.preference` to `[codex, claude]`.
3. Run `employed doctor --no-animation`.
4. If Codex is installed, confirm Codex is active. Otherwise, confirm the first installed enabled
   fallback is active; unavailable providers remain reported rather than causing failure.
5. Restore `[claude, codex]`, rerun doctor, and confirm the active marker follows the new order when
   both binaries are installed.
6. Run the isolated cleanup commands.

### Flow 3: Verify AI-free degradation

1. Start and initialize a new temporary workspace.
2. Set `ai.enabled` to `false` in that workspace's `config.yaml`.
3. Run `employed doctor --no-animation`.
4. Confirm it prints `AI disabled by config`, marks both providers disabled, leaves the active column
   empty, still reports database integrity, and exits successfully.
5. Run `npm test` and confirm the disabled-config contract builds a null AI runner.
6. Run the isolated cleanup commands.

### Flow 4: Verify fallback, cache isolation, and budgets offline

1. Start and initialize a new temporary workspace.
2. Run `npm test` without any live-test environment variable.
3. Confirm the AI runner tests pass: unavailable Codex falls back to Claude, both unavailable produce
   a typed error, and disabled providers are filtered.
4. Confirm an identical task is invoked once because of cache, changing the provider invokes again,
   and cache hits do not consume the two-call budget.
5. Confirm the third uncached invocation reports budget exhaustion.
6. Run the isolated cleanup commands.

### Flow 5: Verify strict JSON correction and timeout handling offline

1. Start and initialize a new temporary workspace.
2. Run `npm test`.
3. Confirm fenced, bare, prose-wrapped, nested-string, and missing-JSON extractor cases pass.
4. Confirm invalid-then-valid output triggers exactly one correction and succeeds, while two invalid
   outputs retain both raw payloads in `AiValidationError`.
5. Confirm provider timeout and missing-binary cases become typed provider errors and the suite exits
   cleanly with no child process left running.
6. Run the isolated cleanup commands.

## Layer 3, Unit 6 — Tier-2/3 static scraper generation

Run `npm run build` before these flows. Generation invokes the active Claude or Codex CLI, so use a
page you are authorized to fetch and expect an AI call unless the result is already cached. Every
flow below explicitly creates and destroys its own workspace.

### Flow 1: Inspect the generation defaults and command

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Confirm `$EMPLOYED_DIR/config.yaml` contains `run.autoGenerateOnAdd: true` with an explanatory
   comment.
4. Run `employed company --help` and confirm `generate <name>` appears.
5. Run `rm -rf "$EMPLOYED_DIR"`.
6. Run `unset EMPLOYED_DIR`.

### Flow 2: Generate explicitly and prove the validation gate persisted it

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Set `run.autoGenerateOnAdd` to `false` in `$EMPLOYED_DIR/config.yaml`.
4. Run `employed company add "Custom Board" --url <STATIC_CAREERS_URL> --no-animation`, replacing
   the placeholder with a static custom careers page that contains repeated job links.
5. Confirm the company is registered as `unknown`, then run
   `employed company generate "Custom Board" --no-animation`.
6. Confirm success reports `generated-static`, a nonzero job count, and confidence from 0.00–1.00.
7. Run `employed company list --no-animation`; confirm method `generated-static`, health `ok`, and
   the same nonzero last yield. A failed gate must instead show its reasons and persist no static
   config.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 3: Automatically generate after unknown-source detection

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Leave `run.autoGenerateOnAdd: true` and run
   `employed company add "Auto Board" --url <STATIC_CAREERS_URL> --no-animation`.
4. Confirm one command detects an unknown source, generates a config, executes it, and reports a
   validated `generated-static` result with a nonzero job count.
5. Run `employed company list --no-animation` and confirm Auto Board is healthy.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 4: Degrade safely when AI is disabled

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Set `ai.enabled` to `false` in `$EMPLOYED_DIR/config.yaml`.
4. Run `employed company add "No AI Board" --url <STATIC_CAREERS_URL> --no-animation`, then run
   `employed company generate "No AI Board" --no-animation`.
5. Confirm the command exits successfully, says AI is unavailable, and suggests rerunning generate
   later.
6. Run `employed company list --no-animation`; confirm the company remains unchanged as `unknown`
   rather than broken.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 5: Exercise distillation, execution, validation, and retry offline

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npm test` without any live-test environment variable.
4. Confirm distiller tests remove scripts, styles, SVG, comments, and unsafe attributes; preserve the
   selector whitelist; remain byte-identical; and cap output at 35 KiB around repeated links.
5. Confirm executor tests cover static fields, absolute URL resolution, two-page `next-link` and
   `url-param` pagination, and render-only escalation.
6. Confirm every validation threshold has passing and failing coverage, including the navigation
   contamination reason.
7. Confirm the fake-AI service tests persist a good config, retry a valid-but-bad config exactly
   once, mark a second failure broken, reuse unchanged-DOM cache, and skip cleanly with null AI.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 6: Perform the optional two-page live acceptance

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed doctor --no-animation` and confirm an enabled provider is installed and active.
4. Set `run.autoGenerateOnAdd` to `false`.
5. Add two real static custom careers pages under distinct company names and explicitly run
   `employed company generate <name> --no-animation` for each.
6. Confirm both configurations pass execution, report nonzero jobs, and appear as healthy
   `generated-static` companies. Treat page redesigns, robots restrictions, or render-only behavior
   as live-site drift rather than weakening the offline validation gate.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

## Layer 3, Unit 7 — Playwright strategy and self-healing

Run `npm run build` first. Browser-backed flows also require `npx playwright install chromium` once
per development machine. Every flow below creates and destroys an independent Employed workspace.

### Flow 1: Verify browser and healing configuration

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npx playwright install chromium` if Chromium has not already been installed for this
   Playwright version.
4. Confirm `$EMPLOYED_DIR/config.yaml` contains `run.playwright.navTimeoutMs: 30000`,
   `run.heal.maxPerCompany: 2`, and `run.heal.maxPerRun: 5` with explanatory comments.
5. Run `rm -rf "$EMPLOYED_DIR"`.
6. Run `unset EMPLOYED_DIR`.

### Flow 2: Verify browser sharing and resource blocking offline

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npm test` without any live-test environment variable.
4. Confirm the browser-pool tests launch one browser for two borrowed pages, block image, font, and
   media requests, preserve script requests, apply the configured timeout, and close every page.
5. Confirm the throwing-operation case still closes both its page and browser.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 3: Verify rendered extraction and pagination offline

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npm test`.
4. Confirm a recorded client-rendered page extracts jobs where its static HTML yields zero.
5. Confirm load-more clicks reveal the second batch and stop when the button disappears.
6. Confirm infinite scroll reaches the expanded content, stops when document height stabilizes, and
   never exceeds `maxPages`.
7. Confirm both strategies use the same field extraction and relative-URL resolution assertions.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 4: Generate a Playwright scraper from a sparse live page

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed doctor --no-animation` and confirm Claude or Codex is installed and active.
4. Set `run.autoGenerateOnAdd` to `false`.
5. Add a client-rendered custom careers page with
   `employed company add "Rendered Board" --url <CLIENT_RENDERED_CAREERS_URL> --no-animation`.
6. Run `employed company generate "Rendered Board" --no-animation`.
7. Confirm the sparse static page is recaptured in Chromium and a passing result reports
   `generated-playwright`, a nonzero job count, and confidence.
8. Run `employed scan --company "Rendered Board" --no-animation`; confirm jobs are extracted through
   the persisted Playwright config.
9. Run `rm -rf "$EMPLOYED_DIR"`.
10. Run `unset EMPLOYED_DIR`.

### Flow 5: Exercise selector-break self-healing offline

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npm test`.
4. Confirm the simulated previously-working selector returns zero on changed HTML during its first
   scan, becomes degraded, records one failure, and does not call AI.
5. Confirm the second scan regenerates a matching config, resets the failure counter, retries once
   in the same run, stores both jobs, and returns health `ok`.
6. Confirm failed regeneration becomes broken with a report note rather than aborting the suite.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 6: Verify healing budgets and AI-free asymmetry

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npm test`.
4. Confirm a third heal attempt for one company is refused with a company-budget note.
5. Confirm the sixth accepted heal across distinct companies is refused with a global-budget note.
6. Confirm an ATS company can re-detect, adopt its new provider, smoke-test, and reset failures with
   no AI runner.
7. Confirm a generated company with no AI remains degraded and reports that regeneration was
   skipped.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

## Layer 4, Unit 1 — Scoring engine

Run `npm run build` first. Each flow below creates and removes its own Employed workspace; no jobs or
keyword edits are reused by another flow.

### Flow 1: Verify the exact scoring model offline

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npm test`.
4. Confirm `New Grad Software Engineer 2026` plus the matching fixture description scores exactly
   `39` in band A.
5. Confirm `Senior Staff Engineer` scores `-32`, every 30/29/18/17/8/7 band boundary passes, and
   uppercase and lowercase titles produce byte-identical results.
6. Confirm title-only and matched-keyword deduplication cases pass without importing DB, HTTP, or
   filesystem modules into the engine test.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 2: See ranked scores during a live scan

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add a currently available Tier-1 board, for example
   `employed company add "Highspot" --url https://jobs.lever.co/highspot --no-animation`.
4. Run `employed scan --company "Highspot" --no-animation`.
5. Confirm the new-job table columns are Score, Band, Title, and Location in that order.
6. Confirm rows are ordered from highest score to lowest score and negative senior/staff signals
   reduce otherwise-positive matches.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 3: Re-score existing jobs after editing a weight

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add and scan one Tier-1 company so the workspace contains open jobs.
4. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT id,title,score,band FROM jobs ORDER BY id LIMIT 5;"`
   and save the displayed values.
5. Add a phrase from one displayed title to the `title` section of
   `$EMPLOYED_DIR/keywords.yaml` with weight `20`.
6. Run `employed rescore --no-animation`; confirm it reports the number of open jobs updated without
   fetching any company.
7. Repeat the SQLite query and confirm matching jobs gained 40 points and their bands changed when a
   threshold was crossed.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 4: Verify title-only scoring remains explicit

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add and scan a SmartRecruiters or Workday company whose list endpoint omits descriptions.
4. Query its jobs with
   `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT title,description,score,band FROM jobs LIMIT 10;"`.
5. Confirm null-description jobs still have integer scores and bands derived from title signals.
6. Run `npm test` and confirm the engine marks blank and null descriptions as `titleOnly: true`.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 5: Verify score persistence and network-free re-scoring offline

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npm test` without any live-test environment variable.
4. Confirm the scrape fixture persists score `10`, band C, and exactly
   `["account executive","ai","apac"]`, then preserves those values on its unchanged second scan.
5. Confirm the re-score fixture changes an open job from score 4/band D to score 20/band B after a
   weight edit, leaves a dismissed job unchanged, and records zero HTTP calls.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

# Layer 4, Unit 2 — Report writer and `employed new`

Run `npm run build` first. Every flow below creates and removes its own Employed workspace; report
files and scanned jobs are never reused between flows.

### Flow 1: Generate an empty daily report

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed new --no-animation` and confirm it reports a manual run with no new jobs.
4. Run `ls "$EMPLOYED_DIR/reports"` and confirm today's `YYYY-MM-DD.md` file exists.
5. Open that file and confirm it contains the date, manual-run line, and `No new jobs.`, with no
   empty Auto-applied or Needs Attention sections.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 2: See newly scanned jobs grouped and ranked

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add a currently available Tier-1 board, for example
   `employed company add "Highspot" --url https://jobs.lever.co/highspot --no-animation`.
4. Run `employed scan --company "Highspot" --no-animation`.
5. Run `employed new --today --no-animation`.
6. Confirm only nonempty band headings appear in A-to-D order, jobs within each band descend by
   score, and rows show company, title, location, and age. Jobs without descriptions show
   `[title-only]`.
7. Open today's file in `$EMPLOYED_DIR/reports` and confirm it contains the same groups, URLs, and
   title-only markers as the terminal view.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 3: Verify JSON and model-level band filtering

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add and scan one Tier-1 company so the workspace contains today's scored jobs.
4. Run `employed new --band A,B --json --no-animation > /tmp/employed-new.json`.
5. Run `node -e 'JSON.parse(require("fs").readFileSync("/tmp/employed-new.json", "utf8"))'` and
   confirm it exits successfully without removing a banner or log line first.
6. Inspect the JSON and confirm `newJobsByBand.C` and `.D` are empty. Open today's Markdown report
   and confirm it likewise contains no Band C or Band D section.
7. Run `rm -f /tmp/employed-new.json`.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 4: Verify same-day report overwrite is idempotent

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed new --no-animation`.
4. Run `shasum "$EMPLOYED_DIR/reports/$(date +%F).md"` and save the checksum.
5. Run `employed new --no-animation` again, then repeat the `shasum` command.
6. Confirm the checksum is unchanged and the directory still contains one file for today rather
   than a duplicate or appended report.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

# Layer 4, Unit 3 — `employed run` orchestration and scheduler

Run `npm run build` first. Every flow below creates and removes its own Employed workspace; no
companies, jobs, runs, or lock files are reused between flows. Because `export` only affects the
current shell, run every step of a flow in one continuous terminal session — do not split a flow
across separate shells or the isolation variable will not carry over.

### Flow 1: Discover the new commands

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed --help` and confirm `run [options]` and `schedule` both appear in the command list.
4. Run `employed run --help` and confirm `--email`, `--no-ai`, and `--tier <tiers>` are documented.
5. Run `employed schedule --help` and confirm `install`, `remove`, and `status` subcommands appear.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 2: Run an empty workspace end to end

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed run --no-animation --no-ai`.
4. Confirm the terminal digest reports `0 companies scanned, 0 new jobs, 0 failures` and a
   Report/Jobs seen/Jobs new/Jobs closed/Scrapers healed/Scrapers broken/AI calls table follows.
5. Run `ls "$EMPLOYED_DIR/reports"` and confirm today's `YYYY-MM-DD.md` exists, and open it to
   confirm it reads `0 companies scanned · 0 jobs seen · 0 new · 0 failures · 0 healed · 0 broken`.
6. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT started_at, finished_at, companies_scanned FROM runs;"`
   and confirm exactly one row with a non-null `finished_at`.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 3: Scrape, score, and report a real company through `run`

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed company add "Highspot" --url https://jobs.lever.co/highspot --no-animation --tier A`
   and confirm it detects `lever`.
4. Run `employed run --no-animation --no-ai`.
5. Confirm the digest shows `1 companies scanned`, a nonzero new-jobs count, and `0 failures`.
6. Open today's file in `$EMPLOYED_DIR/reports` and confirm its Run line's counts match the digest,
   and that new jobs appear grouped by band exactly as they do for `employed new`.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 4: Verify same-day idempotency

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add the same Highspot board as Flow 3.
4. Run `employed run --no-animation --no-ai` and note the new-jobs count.
5. Run `employed run --no-animation --no-ai` again.
6. Confirm the second run reports `0 new jobs` with the same nonzero jobs-seen count, the report
   file's path and content are unchanged aside from the run line, and
   `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT COUNT(*) FROM runs;"` reports `2`.
7. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT COUNT(*) FROM jobs;"` and confirm the count did
   not double.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 5: Verify one company's failure never aborts the run

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add the Highspot board from Flow 3, tier A.
4. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "INSERT INTO companies (name, careers_url, tier, scrape_method, slug, health, created_at) VALUES ('Bad Co', 'https://example.com/careers', 'A', 'greenhouse', NULL, 'untested', CURRENT_TIMESTAMP);"`
   to register a company whose adapter cannot run.
5. Run `employed run --no-animation --no-ai`.
6. Confirm the digest still reports `2 companies scanned`, the Highspot jobs are present, and
   exactly one failure line mentions `Bad Co` and a board slug.
7. Open today's report and confirm the run stats show `1 failures` rather than a crashed command.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 6: Verify the tier scheduler and the `--tier` override

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run
   `employed company add "C Tier Co" --url https://jobs.lever.co/highspot --no-animation --tier C`.
4. Run `employed run --no-animation --no-ai` (the first run; run index 1 excludes tier C) and confirm
   the digest reports `0 companies scanned`.
5. Run `employed run --no-animation --no-ai --tier C` and confirm this run reports
   `1 companies scanned`, proving the override bypasses the schedule.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 7: Verify the two-run lifecycle closure

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add the Highspot board from Flow 3 and run `employed run --no-animation --no-ai` once so its
   jobs and `last_success` are populated.
4. Run
   `sqlite3 "$EMPLOYED_DIR/employed.db" "UPDATE companies SET last_success = '2020-01-01T00:00:00.000Z' WHERE name = 'Highspot';"`
   to simulate that the previous successful scrape happened long ago.
5. Run
   `sqlite3 "$EMPLOYED_DIR/employed.db" "INSERT INTO jobs (company_id, dedupe_key, title, url, status, first_seen, last_seen) SELECT id, 'stale-flow-7', 'Stale Fixture Role', 'https://example.com/stale', 'open', '2019-12-01T00:00:00.000Z', '2019-12-01T00:00:00.000Z' FROM companies WHERE name = 'Highspot';"`
   to insert a job that was already missing before that backdated success.
6. Run `employed run --no-animation --no-ai` again and confirm the digest's `Jobs closed` value is
   at least `1`.
7. Run
   `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT status FROM jobs WHERE dedupe_key = 'stale-flow-7';"`
   and confirm it now reads `closed`.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 8: Verify the run lock refuses collisions and reclaims stale locks

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `mkdir -p "$EMPLOYED_DIR" && echo "$$" > "$EMPLOYED_DIR/run.lock"` to simulate a lock held by
   this shell's own (currently alive) process.
4. Run `employed run --no-animation --no-ai` and confirm it warns that a run is already in progress
   and exits without scraping or writing a report for that invocation.
5. Run `echo "999999999" > "$EMPLOYED_DIR/run.lock"` to simulate a lock left by a dead process.
6. Run `employed run --no-animation --no-ai` and confirm this time it runs normally and the lock
   file no longer contains the stale pid afterward (`cat "$EMPLOYED_DIR/run.lock"` reports no such
   file, since the lock is released on completion).
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 9: Verify `--no-ai` degradation and the AI call counter

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add the Highspot board from Flow 3.
4. Run `employed run --no-animation --no-ai`.
5. Confirm the digest's `AI calls` reads `0` and the run still scrapes and scores Highspot's jobs
   normally, since Tier-1 ATS scraping never depends on AI.
6. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT claude_calls FROM runs ORDER BY id DESC LIMIT 1;"`
   and confirm it also reads `0`.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 10: See the last run in `doctor`

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed doctor --no-animation` and confirm its `Last run` section reports that no run has
   been recorded yet.
4. Add the Highspot board from Flow 3 and run `employed run --no-animation --no-ai`.
5. Run `employed doctor --no-animation` again and confirm the `Last run` section now shows a
   `Started` time, a `Duration`, and matching `New jobs`/`Failures` counts.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 11: Install, inspect, and remove the OS-level daily schedule

This flow writes a **real** launchd agent (macOS) or crontab line (Linux) to your actual system,
because scheduling is inherently a real-machine action outside the isolated `$EMPLOYED_DIR`. Only
run it if you are comfortable with that, and always finish with the `remove` step even if an earlier
step fails.

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed schedule status --no-animation` and confirm it reports no schedule installed.
4. Run `employed schedule install --at 07:30 --no-animation`.
5. Confirm the command prints the generated plist (macOS) or crontab line (Linux) — including an
   absolute path to the `node` binary and to `cli.js` — before printing the success line.
6. Run `employed schedule install --at 08:00 --no-animation` again without `--force` and confirm it
   refuses, naming `employed schedule remove` or `--force` as the way forward.
7. Run `employed schedule status --no-animation` and confirm it reports `installed: yes` with time
   `07:30` and a plausible next-run timestamp.
8. Run `employed schedule remove --no-animation` and confirm it reports the schedule was removed.
9. Run `employed schedule status --no-animation` once more and confirm it again reports nothing
   installed.
10. Run `rm -rf "$EMPLOYED_DIR"`.
11. Run `unset EMPLOYED_DIR`.

# Layer 5, Unit 1 — Rule-based email classifier and company extractor

This unit has no CLI surface yet and touches no `$EMPLOYED_DIR` state — `classify` and
`extractCompany`/`extractRole` are pure functions with zero I/O, consumed only by tests until Layer
5, Unit 2 wires up real Gmail sync. **No validated prototype existed to port** (see decisions.md):
the rules and the fixtures below, including the three named example cases from the spec, are
original and structurally faithful to the layer spec, not literal real-inbox-validated data. Flow 6
below is how you start turning these into the real thing.

### Flow 1: Run the classification fixture suite

1. Run `npm run build`.
2. Run `npm test`.
3. Confirm `classification fixture suite passes 11/11` is among the passing tests, with zero
   failures anywhere in the gmail-related tests.
4. Open `test/fixtures/gmail/classification.json` and confirm it has exactly 11 entries spanning
   `ignore`, `rejected`, `offer`, `oa`, `interview`, `applied`, and one `null` fall-through.

### Flow 2: Prove reject-before-confirm ordering explicitly

1. Run `npm test`.
2. Confirm `a rejection classifies as rejected even though it also reads like a confirmation`
   passes — its fixture email's snippet contains both "thank you for your interest" (an
   applied-style phrase) and "move forward with other candidates" (a rejection phrase), and the
   result must be `rejected`.
3. Open `src/gmail/classify.ts` and confirm the `RULES` array lists `rejected` before `applied`,
   with a comment explaining why the order is load-bearing.

### Flow 3: Prove ignore-first ordering explicitly

1. Run `npm test`.
2. Confirm `a job-alert digest classifies as ignore even when its subject reads as interview-ish`
   passes — its fixture's subject line is deliberately worded ("5 new interview-ready jobs
   matching your search") to look like an interview email, and the sender is a known job-alert
   address (`jobalerts-noreply@linkedin.com`).
3. Confirm the result is `ignore`, not `interview`.

### Flow 4: Prove a fall-through is distinct from a deliberate ignore

1. Run `npm test`.
2. Confirm `a fall-through email is low confidence and null, not silently ignore` passes.
3. Open `src/gmail/types.ts` and confirm `Classification.type` is `EmailClass | null`, and that
   `confidence: 'low'` only ever appears paired with `type: null`.

### Flow 5: Run the extraction fixture suite and the three named tricky cases

1. Run `npm test`.
2. Confirm `extraction fixture suite passes 9/9` passes, alongside the three dedicated tests naming
   Red Hat, Federal Reserve Bank of Atlanta, and Whatnot.
3. Open `test/fixtures/gmail/extraction.json` and confirm `rb@myworkday.com` maps to
   `Federal Reserve Bank of Atlanta` and `redhat@myworkday.com` maps to `Red Hat` via the tier-2
   sender lookup, while the Whatnot case resolves via the tier-1 Ashby subject line instead.
4. Confirm `extraction never imports the classifier` and `classification never imports company or
   role extraction` both pass, proving the two modules have no cross-dependency.

### Flow 6: Validate the rules against one of your own real emails

Since no validated prototype exists yet, this flow is how you start building one. It edits fixture
files directly rather than touching `$EMPLOYED_DIR`.

1. Pick one real application-status email from your inbox (any category — confirmation, rejection,
   interview request, offer, OA, or a job-alert digest you'd expect to be ignored).
2. Add a new entry to `test/fixtures/gmail/classification.json` (or `extraction.json` for a company
   you'd expect to be recognized) with its real `sender`, `subject`, and `snippet`, and the
   `expected`/`expectedCompany` value you believe is correct. Redact anything you don't want
   committed to this repository (names, personal details in the snippet) before saving.
3. Run `npm test`.
4. If it passes, the existing rules already generalize to this real case — leave the fixture in
   place as a small step toward real validation.
5. If it fails, that's a genuine gap: note it in `decisions.md` under the "must be reconciled later"
   entry, and either adjust the relevant pattern in `classify.ts`/`extract-company.ts` (re-running
   `npm test` to confirm nothing else regresses) or leave the fixture as a known failing case to
   revisit once more real samples are collected.

# Layer 5, Unit 2 — Gmail sync via MCP

`employed` never touches Google credentials directly: retrieval and tail classification go through
whichever AI CLI (Claude Code or Codex) you already have configured with its own Gmail MCP
connection. Several flows below explicitly disable AI to verify the clean-degradation path without
making a real AI CLI call; only Flow 6 makes one, and only if you choose to run it.

### Flow 1: Discover the sync command

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed --help` and confirm `sync [options]` appears in the command list.
4. Run `employed sync --help` and confirm `--days <n>` is documented with a default of `30`.
5. Run `rm -rf "$EMPLOYED_DIR"`.
6. Run `unset EMPLOYED_DIR`.

### Flow 2: Run the sync pipeline's automated test suite

1. Run `npm run build`.
2. Run `npm test`.
3. Confirm `rules classify the confident majority; only low-confidence goes to the AI tail`
   passes — proving high-confidence rule matches skip the AI entirely and only the rule
   classifier's fall-through emails are sent to the (fake) AI tail classifier.
4. Confirm `ledger idempotency: a second sync over the same inbox processes 0 new threads` passes.
5. Confirm `cron: high-confidence exact-match auto-applies; low-confidence defers` passes — a
   rule-confident rejection for a tracked company updates that application and appears in
   `autoApplied`, while an AI-tail-resolved email for the same company is deferred, not applied.
6. Confirm `interactive: accepting writes the CRM change; rejecting still ledgers it` passes.
7. Confirm `every CRM write from sync appends a corresponding events row` passes.
8. Confirm `ai === null: sync no-ops cleanly, nothing written, exit successful` passes.

### Flow 3: Verify EMAIL_FETCH always hits AI fresh, EMAIL_CLASSIFY caches, and empty batches are free

1. Run `npm test`.
2. Confirm `EmailFetcher bypasses the cache: two fetches make two AI calls` passes.
3. Confirm `classifying the same batch twice is a single cached AI call` passes.
4. Confirm `an empty low-confidence batch makes zero AI calls` passes.
5. Confirm `noCache tasks skip both the cache read and the cache write` passes (the general
   `AiTask.noCache` mechanism `EmailFetcher` relies on).

### Flow 4: See `employed sync` degrade cleanly without a real AI call

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. In `$EMPLOYED_DIR/config.yaml`, set the top-level `ai.enabled` value to `false`.
4. Run `employed sync --no-animation`.
5. Confirm it prints a message that Gmail sync needs an AI provider with Gmail MCP configured,
   naming `employed doctor`, and exits successfully without writing anything.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 5: See `run`'s reserved Gmail hook stay harmless when Gmail MCP isn't set up

This flow uses `--no-ai` specifically so it never makes a real AI CLI call, since AI availability
alone is what gates whether `run` attempts cron-mode sync.

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed company add "Highspot" --url https://jobs.lever.co/highspot --no-animation --tier A`.
4. Run `employed run --no-animation --no-ai`.
5. Confirm the run completes normally exactly as in the Layer 4, Unit 3 flows (scrapes, scores,
   writes a report) — the Gmail hook is skipped entirely because AI is off, so it has no effect.
6. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT COUNT(*) FROM applications;"` and confirm it
   reports `0`, since no sync ran.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 6 (optional, makes a real AI call): Try live Gmail sync end to end

Only run this if you have Claude Code or Codex configured with a working Gmail MCP connection —
otherwise this will simply fail to fetch anything, which is expected and harmless (Flow 5 already
covers the "not configured" path without spending a real AI call).

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed sync --days 30 --no-animation`.
4. Confirm it reports how many threads were fetched and how many are new.
5. If any proposals appear, confirm the multi-select prompt lists company, role (when known), and
   whether it would create a new application or update an existing one; accept or reject a few and
   confirm the command's summary table (Applied/Deferred/Ignored/Unresolved) matches your choices.
6. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT company_name, role, status FROM applications;"`
   and `SELECT thread_id, application_id, classified_as FROM email_threads;"` and confirm they
   reflect exactly what you accepted or rejected.
7. Run `employed sync --days 30 --no-animation` again and confirm every previously-seen thread is
   excluded (0 new among them), proving the ledger works against your real inbox too.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

# Layer 5, Unit 3 — CRM commands: `apply`, `board`, `app`, `note`, `move`, `dismiss`

Unlike Units 1 and 2, every command here works fully offline with no AI or Gmail dependency — all
flows below can be run exactly as written, no live network or MCP connection needed.

### Flow 1: Discover the CRM commands

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed --help` and confirm `apply`, `board`, `app`, `note`, `move`, and `dismiss` all
   appear in the command list.
4. Run `employed move --help` and confirm its description lists the valid status values.
5. Run `rm -rf "$EMPLOYED_DIR"`.
6. Run `unset EMPLOYED_DIR`.

### Flow 2: Promote a scraped job into a tracked application, idempotently

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed company add "Highspot" --url https://jobs.lever.co/highspot --no-animation --tier A`.
4. Run `employed scan --company "Highspot" --no-animation`.
5. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT id, title FROM jobs LIMIT 1;"` and note the id.
6. Run `employed apply <jobId> --resume backend-v2 --no-animation` and confirm it reports the
   application created with the job's company and title.
7. Run the same `employed apply <jobId> --resume backend-v2 --no-animation` command again and
   confirm it now reports "Already applied" with the same application id, rather than duplicating.
8. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT COUNT(*) FROM applications;"` and confirm `1`.
9. Run `rm -rf "$EMPLOYED_DIR"`.
10. Run `unset EMPLOYED_DIR`.

### Flow 3: View the pipeline board, including the empty state and collapsed rejections

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed board --no-animation` and confirm it guides you toward `apply`/`sync` with no
   applications yet.
4. Add and scan Highspot as in Flow 2, then `employed apply <jobId> --no-animation`.
5. Run `employed board --no-animation` and confirm the Applied column shows the new application
   with company, role, an age of "just now", and its résumé (or `—` if none was given).
6. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT id FROM applications LIMIT 1;"`, then
   `employed move <appId> rejected --no-animation`.
7. Run `employed board --no-animation` again and confirm the Rejected column shows a collapsed
   count ("1 rejected — pass --all to show them") rather than the full row.
8. Run `employed board --all --no-animation` and confirm the Rejected column now shows the full row.
9. Run `rm -rf "$EMPLOYED_DIR"`.
10. Run `unset EMPLOYED_DIR`.

### Flow 4: Manual status transitions, including an unusual one

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add, scan, and apply to Highspot as in Flow 2; note the application id.
4. Run `employed move <appId> interview --no-animation` and confirm success with no warning
   (`applied → interview` is an expected transition).
5. Run `employed move <appId> rejected --no-animation` to end the pipeline.
6. Run `employed move <appId> oa --no-animation` and confirm it still succeeds, but now prints a
   one-line "Unusual transition: rejected → oa" warning rather than refusing.
7. Run `employed move <appId> not-a-real-status --no-animation` and confirm it fails with an error
   naming the valid status values, and exits unsuccessfully.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 5: See the full event timeline, including notes

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add, scan, and apply to Highspot as in Flow 2; note the application id.
4. Run `employed move <appId> interview --no-animation`.
5. Run `employed note <appId> "Recruiter said they'd follow up next week." --no-animation`.
6. Run `employed app <appId> --no-animation`.
7. Confirm the header shows status `interview`, a résumé value, and non-empty Applied/First
   response/Last activity fields.
8. Confirm the event timeline lists exactly two events, oldest to newest: `applied` (blank note)
   then `interview` (blank note) — then run the command again after adding the note in step 5 and
   confirm a third `note` event appears last with your exact text.
9. Run `rm -rf "$EMPLOYED_DIR"`.
10. Run `unset EMPLOYED_DIR`.

### Flow 6: Dismiss a job without touching its application

Verify dismissal by job id via SQLite rather than by title text — a live careers board can list the
same title twice under different postings (different location or dedupe key), so grepping report
output for a title is not a reliable way to confirm one specific job was excluded.

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add and scan Highspot as in Flow 2.
4. Apply to one job (Flow 2) and move it to `interview` (Flow 4); note both the job id and the
   application id.
5. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT status FROM jobs WHERE id = <jobId>;"` and
   confirm it reads `open`.
6. Run `employed dismiss <jobId> --no-animation`.
7. Run the same `sqlite3 ... SELECT status FROM jobs WHERE id = <jobId>;` query again and confirm
   it now reads `dismissed`.
8. Run `employed new --no-animation`, then
   `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT COUNT(*) FROM jobs WHERE id = <jobId> AND status = 'open';"`
   and confirm `0`, proving that specific job is excluded from the open-jobs report query.
9. Run `employed app <appId> --no-animation` and confirm the application is untouched — still
   status `interview`, unaffected by the dismissal.
10. Run `employed dismiss 999999 --no-animation` and confirm it reports the job does not exist
    rather than crashing.
11. Run `rm -rf "$EMPLOYED_DIR"`.
12. Run `unset EMPLOYED_DIR`.

### Flow 7: Verify the transition chokepoint and manual/Gmail-origin parity via the test suite

1. Run `npm run build`.
2. Run `npm test`.
3. Confirm `createManual produces a job-id-null application indistinguishable in listings` passes.
4. Confirm `a sync-driven rejection matches a manual move-to-rejected event shape` passes — this is
   the concrete proof that `SyncService` (Layer 5, Unit 2) now routes every write through the same
   `ApplicationService.transition` chokepoint `move` uses, rather than writing directly.
5. Confirm `an unusual transition warns but still succeeds` and `transition rejects an unknown
   application id` both pass.
6. Confirm `applications: touchActivity and setFirstResponse are separate, explicit writes` passes.

# Layer 6, Unit 1 — `employed stats`: analytics, sparkline, and nudges

`stats` is fully offline and deterministic — every flow below runs with no AI or network dependency.

### Flow 1: Discover the stats command

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed --help` and confirm `stats [options]` appears in the command list.
4. Run `employed stats --help` and confirm `--json` is documented.
5. Open `$EMPLOYED_DIR/config.yaml` and confirm it has a `stats:` section with `followUpDays`,
   `staleDays`, `minKeywordSample`, and `minResumeSample`, each with an explanatory comment.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 2: See the empty state

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `employed stats --no-animation`.
4. Confirm it prints an encouraging message pointing at `apply`/`sync` rather than a wall of zeros,
   NaNs, or empty tables.
5. Run `rm -rf "$EMPLOYED_DIR"`.
6. Run `unset EMPLOYED_DIR`.

### Flow 3: Build a small application history and verify the headline rates

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add and scan Highspot (`employed company add "Highspot" --url https://jobs.lever.co/highspot
   --no-animation --tier A` then `employed scan --company "Highspot" --no-animation`).
4. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT id FROM jobs ORDER BY id LIMIT 1 OFFSET 0;"`,
   then again with `OFFSET 1` and `OFFSET 2`, to get three job ids.
5. Run `employed apply <job1> --resume backend-v2 --no-animation`,
   `employed apply <job2> --resume backend-v2 --no-animation`, and
   `employed apply <job3> --resume generalist-v1 --no-animation`.
6. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT id FROM applications ORDER BY id LIMIT 1 OFFSET 0;"`
   and again with `OFFSET 1` to get the first two application ids.
7. Run `employed move <app1> interview --no-animation` and `employed move <app2> rejected
   --no-animation`, leaving the third application untouched (still `applied`).
8. Run `employed stats --no-animation`.
9. Confirm it reads `3 applications`, `67% response rate` (2 of 3 ever got a response — interview
   and rejection both count), `33% positive response rate` (only the interview is a positive
   signal), and `33% interview rate`.
10. Run `rm -rf "$EMPLOYED_DIR"`.
11. Run `unset EMPLOYED_DIR`.

### Flow 4: Verify the résumé cross-tab and low-signal flagging

1. Repeat steps 1–8 of Flow 3 in a fresh workspace.
2. Confirm the "Outcomes by résumé version" table shows `backend-v2` with 2 applications, 100%
   response rate (both the interview and the rejection count as a response), 50% interview rate,
   and `generalist-v1` with 1 application, 0%/0%.
3. Confirm both rows show `low` in the Signal column — 1–2 applications is below the default
   `minResumeSample: 3`.
4. Add a fourth application using `backend-v2` again (apply to a 4th job with that résumé label)
   and confirm `backend-v2` now shows `ok` once it reaches 3 applications.
5. Run `rm -rf "$EMPLOYED_DIR"`.
6. Run `unset EMPLOYED_DIR`.

### Flow 5: Verify the keyword correlation floor

1. Repeat steps 1–8 of Flow 3 in a fresh workspace.
2. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "SELECT matched_kw FROM jobs;"` and note which keywords
   appear on at least 2 of the three applied-to jobs.
3. Run `employed stats --no-animation` and confirm the keyword correlation table lists exactly
   those keywords (each with at least 2 applications) and omits any keyword that appears on only
   one job, per the default `minKeywordSample: 2`.
4. Confirm the table's heading notes the metric is "directional, not causal."
5. Run `rm -rf "$EMPLOYED_DIR"`.
6. Run `unset EMPLOYED_DIR`.

### Flow 6: Verify follow-up nudges and stale flags by age threshold

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add and scan Highspot, then apply to two different jobs and note both application ids.
4. Run
   `sqlite3 "$EMPLOYED_DIR/employed.db" "UPDATE applications SET last_activity_at = datetime('now', '-10 days') WHERE id = <app1>;"`
   to simulate 10 quiet days on the first application.
5. Run
   `sqlite3 "$EMPLOYED_DIR/employed.db" "UPDATE applications SET last_activity_at = datetime('now', '-30 days') WHERE id = <app2>;"`
   to simulate 30 quiet days on the second.
6. Run `employed stats --no-animation`.
7. Confirm "Consider following up" lists application `<app1>` with a days-quiet value of 9 or 10
   (rounded down from the sub-second gap between the SQL update and the stats command running —
   both are ≥ the default 7-day `followUpDays` and under 21), and "Probably stale" lists `<app2>`
   with a days-quiet value of 29 or 30 (≥ the default 21-day `staleDays`).
8. Run `employed move <app1> rejected --no-animation`, then `employed stats --no-animation` again
   and confirm `<app1>` no longer appears in either list — `rejected` is excluded regardless of age.
9. Run `rm -rf "$EMPLOYED_DIR"`.
10. Run `unset EMPLOYED_DIR`.

### Flow 7: Verify the `--json` round trip

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add and scan Highspot, then apply to one job.
4. Run `employed stats --json --no-animation > /tmp/employed-stats.json`.
5. Run `node -e 'JSON.parse(require("fs").readFileSync("/tmp/employed-stats.json", "utf8"))'` and
   confirm it exits successfully with no banner or log line mixed into the output.
6. Inspect the JSON and confirm it has `totalApplications`, `responseRate`, `sparkline.chart`,
   `outcomesByBand`, `outcomesByResume`, `keywordCorrelation`, `nudges`, and `stale` fields.
7. Run `rm -f /tmp/employed-stats.json`.
8. Run `rm -rf "$EMPLOYED_DIR"`.
9. Run `unset EMPLOYED_DIR`.

### Flow 8: Verify event-scan discipline and the sparkline helper via the test suite

1. Run `npm run build`.
2. Run `npm test`.
3. Confirm `event-scan metrics, cross-tabs, and keyword correlation match hand-computed values`
   passes — this is the proof that an application which reached `interview` and was *later*
   rejected still counts toward the interview rate (an event-scan, not a current-status read).
4. Confirm `an independent event-diff computation matches the first_response_at-based average`
   passes.
5. Confirm `a database with zero applications renders every rate as null, not NaN` passes.
6. Confirm all four `sparkline` tests pass: 12-bucket scaling, the all-zero flat line, a single
   spike, and the empty-series case.

# Layer 6, Unit 2 — SMTP email digest and completed doctor

Every stateful flow below starts from a blank workspace and destroys it afterward. Run
`npm run build` first so the globally linked `employed` binary uses the latest `dist` output.

### Flow 1: Inspect the safe default SMTP template

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Open `$EMPLOYED_DIR/config.yaml` and confirm `email.enabled` is false, Gmail host/port defaults
   are present, the environment-password export is recommended, and plaintext `password` is
   commented out.
4. Run `employed doctor --no-animation` and confirm Email / SMTP says disabled with setup guidance;
   this warning still exits zero.
5. Run `rm -rf "$EMPLOYED_DIR"`.
6. Run `unset EMPLOYED_DIR`.

### Flow 2: Verify SMTP and receive a real digest

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Edit `$EMPLOYED_DIR/config.yaml`: set `email.enabled: true`, fill `to`, `from`, and `smtp.user`,
   and leave the plaintext password commented out.
4. Run `export EMPLOYED_SMTP_PASSWORD="<YOUR_SMTP_APP_PASSWORD>"`.
5. Run `employed doctor --no-animation`; confirm Email / SMTP is enabled and reachable.
6. Run `employed run --email --no-ai --no-animation`; confirm the local report is written first and
   the command reports `Email digest sent.`.
7. Confirm the inbox received a multipart digest whose subject states total new roles, A-band
   count, and today's date.
8. Run `unset EMPLOYED_SMTP_PASSWORD`.
9. Run `rm -rf "$EMPLOYED_DIR"`.
10. Run `unset EMPLOYED_DIR`.

### Flow 3: Confirm forced email failure never loses or fails a run

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Leave email disabled and unconfigured, then run
   `employed run --email --no-ai --no-animation`.
4. Confirm the run completes successfully, warns that `email.to` is required, and prints the path
   of the report that remains available on disk.
5. Open today's file under `$EMPLOYED_DIR/reports` and confirm it is a complete Markdown report.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 4: Surface a broken scraper and crashed run in doctor

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "INSERT INTO companies
   (name,careers_url,health,consecutive_failures,created_at) VALUES
   ('Broken Board','https://example.com/jobs','broken',2,CURRENT_TIMESTAMP);"`.
4. Run `sqlite3 "$EMPLOYED_DIR/employed.db" "INSERT INTO runs (started_at)
   VALUES (datetime('now','-1 hour'));"` to create an intentionally incomplete run record.
5. Run `employed doctor --no-animation`; confirm it exits zero, names Broken Board with a generate
   command, and flags the null `finished_at` with run-recovery guidance.
6. Run `employed doctor --strict --no-animation`; confirm the same diagnostics render and the exit
   status is nonzero.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

### Flow 5: Verify all offline delivery and diagnostic boundaries

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npm test` without live-test environment variables.
4. Confirm the email tests prove environment-password precedence, multipart content, HTML escaping,
   omitted empty sections, typed send failure, and non-throwing verification status.
5. Confirm the run test proves an SMTP failure leaves the report readable and closes the run row.
6. Confirm the doctor test surfaces Gmail, SMTP, broken-fleet, crashed-run, and scheduler guidance
   while SQLite `total_changes()` remains unchanged.
7. Run `rm -rf "$EMPLOYED_DIR"`.
8. Run `unset EMPLOYED_DIR`.

# Layer 6, Unit 3 — portability, setup guide, and animation polish

Run `npm run build` first. Every stateful flow owns and destroys all temporary workspaces it creates.

### Flow 1: Round-trip a native snapshot through a fresh workspace

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Add/scan a company and apply to a resulting job so all four exported datasets contain data.
4. Run `employed export --json --out /tmp/employed-backup.json --no-animation`; confirm version `1`
   and nonzero company, job, application, and event arrays.
5. Run `export EMPLOYED_SOURCE_DIR="$EMPLOYED_DIR"`, then
   `export EMPLOYED_DIR="$(mktemp -d)"` and `employed init --no-animation`.
6. Run `employed import-hq /tmp/employed-backup.json --dry-run --no-animation`, confirm no writes,
   then commit the import and compare a fresh export's four datasets with the original.
7. Import again and confirm every created count is zero.
8. Run `rm -rf "$EMPLOYED_SOURCE_DIR" "$EMPLOYED_DIR" /tmp/employed-backup.json`.
9. Run `unset EMPLOYED_SOURCE_DIR` and `unset EMPLOYED_DIR`.

### Flow 2: Import a legacy Job Search HQ backup safely

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Create `/tmp/job-search-hq.json` with an interview-status `apps` entry, one new scoring keyword,
   and one `seen` thread id.
4. Dry-run `employed import-hq /tmp/job-search-hq.json --dry-run --no-animation`; confirm it predicts
   one application, two events, one scoring key, and one thread while SQLite stays empty.
5. Commit the import. Confirm the `applied` and `interview` events are tagged `Imported`, the thread
   is ledgered, and the new keyword appears without replacing existing weights.
6. Import again and confirm applications and threads are skipped with no duplicate events.
7. Run `rm -rf "$EMPLOYED_DIR" /tmp/job-search-hq.json`.
8. Run `unset EMPLOYED_DIR`.

### Flow 3: Open both CSV exports in a spreadsheet

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Populate a job and application, including a note with a comma or newline.
4. Export `--csv --kind applications --out /tmp/applications.csv` and
   `--csv --kind jobs --out /tmp/jobs.csv`.
5. Open both files in a spreadsheet and confirm columns align and quoted content stays in one cell.
6. Run `rm -rf "$EMPLOYED_DIR" /tmp/applications.csv /tmp/jobs.csv`.
7. Run `unset EMPLOYED_DIR`.

### Flow 4: Verify animated and plain output

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. In a TTY, run `employed new`; confirm the gradient wordmark appears once and fast work does not
   flash a short-lived spinner.
4. Add two companies and run `employed run`; confirm progress advances from `[1/2] Company` to
   `[2/2] Company` rather than stacking spinners.
5. Run `employed new --no-animation` and `employed export --json | head`; confirm neither contains
   the wordmark or ANSI escapes.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 5: Follow the README on a clean checkout

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. In a clean checkout, follow README prerequisites, quick start, one AI-provider setup, company
   import, doctor, and a no-email run.
4. Confirm doctor explains intentionally omitted integrations and `employed run --no-ai` writes a
   daily report.
5. Run `npm test`; confirm portability coverage passes without live services.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

# Remediation — multi-hop ATS detection and known-slug overrides

Run `npm run build` first. Each flow below starts from a newly initialized workspace and destroys it
afterward; do not reuse an earlier flow's state.

### Flow 1: Verify a known override bypasses detection HTTP

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Confirm `$EMPLOYED_DIR/known_ats.yaml` exists and contains only commented guidance by default.
4. Run `npm test -- --test-name-pattern="known ATS override returns before any HTTP request"`.
5. Confirm the test passes and proves the Airbnb override returns `greenhouse` / `airbnb` with an
   HTTP call count of zero.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 2: Detect Airbnb through the bounded live crawl

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Leave `known_ats.yaml` empty so this flow exercises automatic detection.
4. With internet access, run `EMPLOYED_LIVE_ATS_TESTS=1 npm test --
   --test-name-pattern="live detector and adapters"`.
5. Confirm the live case identifies `https://careers.airbnb.com` as Greenhouse slug `airbnb`.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.

### Flow 3: Verify ranking, exclusions, multi-hop matching, and the hard cap offline

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Run `npm test -- --test-name-pattern="browse candidates|detail candidates|landing to browse to
   detail|pathological crawl"`.
4. Confirm relative URLs resolve, duplicate/social/mail links are excluded, depth-2 Greenhouse is
   found, and the pathological fixture makes exactly five requests before returning unknown.
5. Run `rm -rf "$EMPLOYED_DIR"`.
6. Run `unset EMPLOYED_DIR`.

### Flow 4: Reject a malformed override with an actionable field path

1. Run `export EMPLOYED_DIR="$(mktemp -d)"`.
2. Run `employed init --no-animation`.
3. Replace `$EMPLOYED_DIR/known_ats.yaml` with an `Airbnb` entry whose `method` is `unsupported` and
   whose `slug` is empty.
4. Run `employed company list --no-animation`.
5. Confirm the command fails cleanly, names `known_ats.yaml`, and identifies both the invalid
   `Airbnb.method` and `Airbnb.slug` fields.
6. Run `rm -rf "$EMPLOYED_DIR"`.
7. Run `unset EMPLOYED_DIR`.
