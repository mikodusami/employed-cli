## Layer 1, Unit 1 — Project scaffold and CLI entry point

Run these flows from the repository root after `npm install` and `npm run build`.

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

Run these flows after `npm run build`. They operate on `~/.employed`; back up that directory first
if it already contains data you care about.

### Flow 1: Initialize a fresh workspace

1. Run `employed init --no-animation`.
2. Confirm the command reports valid configuration and database schema version 1.
3. Confirm `~/.employed` contains `config.yaml`, `companies.yaml`, `keywords.yaml`, `employed.db`,
   `reports/`, and `logs/`.
4. Open the YAML files and confirm their comments explain the available settings.
5. Confirm `keywords.yaml` includes `new grad: 6`, `machine learning: 2`, and
   `phd required: 6` in their respective title, description, and negative lists.
6. Confirm `config.yaml` enables AI globally, enables both Claude and Codex, and lists
   `[claude, codex]` as the provider preference order.
7. Change the preference to `[codex, claude]`, disable either provider, and run
   `employed init --no-animation`; confirm the edited valid configuration is preserved.

### Flow 2: Prove initialization is idempotent

1. Add a comment to `~/.employed/config.yaml`.
2. Run `employed init --no-animation` again.
3. Confirm it says the workspace is already initialized and no files were changed.
4. Confirm your added comment is still present.

### Flow 3: Recover a partially initialized workspace

1. Move one generated YAML file out of `~/.employed` temporarily.
2. Run `employed init --no-animation`.
3. Confirm only the missing file is recreated and the other two are reported as preserved.
4. Restore your original file if it contained edits you want to keep.

### Flow 4: See an actionable validation error

1. Set `run.concurrency` to `99` in `~/.employed/config.yaml`.
2. Run `employed init --no-animation`.
3. Confirm the error names `config.yaml`, identifies `run.concurrency`, and exits unsuccessfully.
4. Restore concurrency to a value from 1 through 10 and rerun init successfully.

### Flow 5: Run the automated persistence contract

1. Run `npm test`.
2. Confirm all configuration and SQLite tests pass, including migration rollback, foreign-key
   enforcement, WAL mode, deduplication, memoization, and transaction rollback.

### Flow 6: Reinitialize a pre-reconciliation development database

This flow applies only if you ran Layer 2 before the authoritative §6 schema was supplied.

1. Back up `~/.employed/employed.db` if it contains data you want to inspect later.
2. Move the old database outside `~/.employed`.
3. Run `employed init --no-animation`.
4. Confirm a new database is created at schema version 1.
5. Run `npm test` and confirm all eleven persistence and configuration checks pass.

## Layer 2, Unit 2 — Company registry and import

Run `npm run build` and `employed init --no-animation` before these flows.

### Flow 1: Add and detect a company

1. Run `employed company add "Stripe" --url https://stripe.com/jobs --tier A --no-animation`.
2. Confirm Stripe is added with `method: unknown` and the future-detection message.
3. Run `employed company list --no-animation`.
4. Confirm Stripe shows tier A, method unknown, health untested, and empty last-yield/success values.

### Flow 2: Verify case-insensitive duplicate protection

1. Run `employed company add "stripe" --url https://example.com/jobs --no-animation`.
2. Confirm it reports Stripe is already registered and makes no changes.
3. Run `employed company list --no-animation` and confirm only one Stripe row exists.

### Flow 3: See clean URL validation

1. Run `employed company add "Bad URL" --url ftp://example.com/jobs --no-animation`.
2. Confirm the command exits unsuccessfully with `Careers URL must use http or https.`
3. Confirm no stack trace is displayed and Bad URL does not appear in the company list.

### Flow 4: Inspect automation-safe table output

1. Run `employed company list | cat`.
2. Confirm columns remain aligned and no color or spinner control characters appear.

### Flow 5: Import a company file idempotently

1. Add two valid entries to `~/.employed/companies.yaml` and run
   `employed import --no-animation`.
2. Confirm the summary reports two created, zero skipped, and zero failed.
3. Run the same command again.
4. Confirm the summary reports zero created, two skipped-duplicate, and zero failed.

### Flow 6: Contain one malformed import entry

1. Add a third entry whose URL is `ftp://example.com/jobs`.
2. Run `employed import --no-animation`.
3. Confirm valid entries are skipped as duplicates, the malformed entry is reported as failed by
   name, and the command reaches its final summary.

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

1. Run `employed scan --company Highspot --no-animation`.
2. Confirm the summary reports a nonzero seen count and the same number of new jobs.
3. Confirm the new-job table contains title, location, and URL columns.

### Flow 3: Prove end-to-end deduplication

1. Immediately run `employed scan --company Highspot --no-animation` again.
2. Confirm it reports the same seen count and `0 new`.
3. Confirm no new-job table is printed on the second run.

### Flow 4: Distinguish an unsupported source

1. Add Linear from `https://jobs.ashbyhq.com/linear` if it is not already registered.
2. Run `employed scan --company Linear --no-animation`.
3. Confirm the command reports that Linear was skipped because no Ashby source is implemented yet,
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
