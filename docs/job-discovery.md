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

If no ATS matches and AI is enabled, employed can generate a data-only scraper configuration:

```bash
employed company generate "Company Name"
```

The generation path strips scripts/styles/noise, keeps selector-relevant HTML, limits the input
size, asks the active provider for selectors and pagination, executes the result, and validates its
output before saving it. A syntactically valid but ineffective scraper gets one feedback retry.

Static configurations use HTTP plus Cheerio. Render-only pages use one shared Playwright Chromium
instance, block images/fonts/media, and support next links, URL parameters, load-more buttons, and
bounded infinite scrolling.

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
5. Stores score, band, and every matched keyword.
6. Updates company health and last-success data.

Re-scanning does not duplicate jobs. It refreshes `last_seen` and scoring signals.

## Self-healing

A previously healthy scraper yielding nothing or throwing once becomes degraded. On a consecutive
failure, the shared heal budget allows repair:

- ATS companies re-run detection first in case the company changed providers.
- Generated companies regenerate and validate their configuration.
- Successful repair resets failures and retries the scrape once in the same run.
- Failed repair becomes broken and appears in the daily report and `doctor`.

AI-free runs can repair ATS migrations but cannot regenerate custom scrapers. They degrade safely
instead of aborting the fleet.

## Scores and bands

The pure scoring engine applies the profile in `keywords.yaml`:

- title signals: configured weight × 2
- description signals: configured weight × 1
- negative signals found in combined title/description: configured weight × −2

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

This updates every open job without fetching a company or invoking AI.

## Job lifecycle

Jobs begin `open`. A job missing from two consecutive successful company scrapes becomes `closed`.
To hide an irrelevant role immediately:

```bash
employed dismiss JOB_ID
```

Dismissal affects reports but does not create or alter an application. If you applied to a job, use
the separate CRM commands described in [Application tracking](application-tracking.md).
