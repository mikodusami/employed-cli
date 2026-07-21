# Job discovery and scoring

This guide explains how companies become reliable job sources, how postings are maintained, and why
a role receives its score and band.

## Company registry

Add one company directly:

```bash
employed company add "Company Name" \
  --url https://company.example/careers \
  --tier A
```

List current state:

```bash
employed company list
```

The list shows tier, scraper method, health, yield, and last success. Health values mean:

- `untested` — registered but no successful scrape yet.
- `ok` — the latest meaningful scrape succeeded.
- `degraded` — one failure occurred; employed waits before attempting repair.
- `broken` — repeated extraction/repair failure needs attention.

## Tiers and run frequency

- Tier A companies run every daily run.
- Tier B static/ATS companies run every day.
- Tier B Playwright companies run every second run because browser rendering is more expensive.
- Tier C companies run every third run.

Override scheduling for a one-off run:

```bash
employed run --tier A,B
```

## Detection and adapters

When a company is added, employed fetches its careers page and checks URL/HTML signatures for:

- Greenhouse
- Lever
- Ashby
- Workday
- SmartRecruiters
- Recruitee

Known ATS sources use deterministic APIs. They are the cheapest, fastest, and most reliable path.
Workday and SmartRecruiters pagination is bounded to prevent infinite sources.

Detection first checks the case-insensitive company name in `known_ats.yaml`. A match selects that
adapter without fetching the careers page. Otherwise, employed performs a bounded static crawl:

1. Inspect the supplied careers page (depth 0).
2. Rank and inspect at most two likely job-browse links (depth 1).
3. From the strongest browse page, inspect likely job-detail links (depth 2).
4. Stop after five total page requests even when a site exposes many links.

Relative links are resolved against their page, duplicates and social/mail links are ignored, and
no headless browser is launched merely for detection. Detection output records the matching depth
and URL path so surprising results can be diagnosed. Use a verified `known_ats.yaml` entry when a
site cannot expose its ATS within this intentionally small crawl budget.

## Generated scrapers

If no ATS matches and AI is enabled, employed can generate a versioned, data-only scraper plan:

```bash
employed company generate "Company Name"
```

The AI never writes executable code. It selects one of two hardened runtimes:

- `dom`: selectors, bounded pre-extraction navigation, and static or Playwright pagination.
- `api`: a same-domain or known-ATS JSON endpoint, safe dot paths, and bounded page/offset
  pagination. Only `accept` and `content-type` request headers are permitted.

Generation is an explicit evidence loop. It captures static HTML first, distills the DOM and link
patterns, plans, executes, and validates. A failed plan is returned to the AI as structured retry
feedback. Sparse client-rendered pages skip weak static planning and escalate directly to rendered
DOM plus a bounded log of JSON-like XHR/fetch responses. Hidden job APIs are preferred when that
network evidence exposes them.

At most four attempts run by default. Every static or browser capture has an absolute deadline;
browser pages are closed when it expires. A successful plan is persisted as version 2 with method
`generated-api`, `generated-static`, or `generated-playwright`. Existing version-1 DOM configs are
wrapped automatically by database migration 4.

Static plans use HTTP plus Cheerio. Render-only pages use one shared Playwright Chromium
instance, block images/fonts/media, and support next links, URL parameters, load-more buttons, and
bounded infinite scrolling.

If every attempt fails, the company becomes `manual-review`. Employed writes captured HTML, network
evidence, navigation history, and every attempted plan with validation errors under
`~/.employed/debug/<company>-<timestamp>/`. This bundle is designed for a quick manual plan repair
or confirmation that the company belongs in `known_ats.yaml`.

## Scanning

Scan one company:

```bash
employed scan --company "Company Name"
```

If `--company` is omitted, follow the command's current prompt/output guidance. A successful scan:

1. Fetches and extracts raw postings.
2. Normalizes titles, URLs, identifiers, and timestamps.
3. Deduplicates by ATS identifier or a stable title/URL key.
4. Scores new and refreshed jobs.
5. Applies the `hardExclude`/`locations` gate (see below) and stores score, band, matched
   keywords, and — for excluded postings — a filter reason.
6. Updates company health and last-success data.

Re-scanning does not duplicate jobs. It refreshes `last_seen` and scoring signals. The success line
reports auto-filtered postings alongside seen/new counts, split by cause, for example:

```text
✓ Highspot (lever): 18 seen, 14 new, 4 (4 keyword, 0 location) auto-filtered
```

The clause is omitted entirely (not printed as zero) when nothing was filtered.

## Self-healing

A previously healthy scraper yielding nothing or throwing once becomes degraded. On a consecutive
failure, the shared heal budget allows repair:

- ATS companies re-run detection first in case the company changed providers.
- Generated companies re-enter generation at rendered/network evidence because the site changed.
- Successful repair resets failures and retries the scrape once in the same run.
- Failed repair becomes broken and appears in the daily report and `doctor`.

AI-free runs can repair ATS migrations but cannot regenerate custom scrapers. They degrade safely
instead of aborting the fleet.

## Scores and bands

The pure scoring engine applies the profile in `keywords.yaml`:

- title signals: configured weight × 2
- description signals: configured weight × 1
- negative signals found in combined title/description: configured weight × −2

Matching is case-insensitive and word-boundary-aware — a keyword fires only as a whole word or
phrase (`ai` matches "AI Engineer", not "domain"), not as a raw substring.

Bands are:

- A: score 30 or higher
- B: score 18–29
- C: score 8–17
- D: score below 8

Jobs without descriptions still score from title and are marked `title-only`, which means a low score
may reflect missing evidence rather than poor fit.

Tune weights, then run:

```bash
employed rescore
```

This updates every open job without fetching a company or invoking AI, and reports how many jobs'
bands moved up or down as a result:

```text
✓ Re-scored 14 open jobs — 3 moved up, 1 moved down
```

## Auto-filtered jobs

`negative` weights in `keywords.yaml` only lower score/band — a heavily-penalized job can still
outscore the penalty and appear in reports. `hardExclude` and `locations` are a separate, stricter
gate: a match removes the job from reports entirely. This is useful for terms that are always
disqualifying for you (seniority level, a security clearance requirement) rather than just
undesirable. See [Configuration](configuration.md#keywordsyaml) for the full syntax; both sections
default to empty, so nothing is filtered until you populate them.

An excluded job is still stored (so dedupe, history, and later re-tuning all still work), marked
`dismissed`, and tagged with the specific match that excluded it. Review what got filtered:

```bash
employed new --show-filtered
```

This adds an "Auto-filtered today" table below the normal listing, showing each job's id, title,
location, and reason (for example `hard-exclude title: senior` or `location blocked: india`). The
default `employed new` (no flag) never shows these — the filter is silent by design, but never
un-reviewable. If a filter turns out to be too aggressive, undo it for one job:

```bash
employed restore JOB_ID
```

`restore` only works on system-filtered jobs (`filter_reason` set); it refuses with a clear message
on a job you dismissed manually with `employed dismiss`, since that was your own decision, not the
filter's. Once a job is filtered or dismissed, a later scrape never silently reopens or re-labels
it — even if you later remove the disqualifying term from `keywords.yaml` — `restore` is the only
way back to `open`.

## Job lifecycle

Jobs begin `open`. A job missing from two consecutive successful company scrapes becomes `closed`.
To hide an irrelevant role immediately:

```bash
employed dismiss JOB_ID
```

Dismissal affects reports but does not create or alter an application. If you applied to a job, use
the separate CRM commands described in [Application tracking](application-tracking.md). A manual
`dismiss` is distinct from an auto-filter (see above): only an auto-filtered job can be undone with
`employed restore`.
