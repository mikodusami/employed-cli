# Getting started

This guide takes you from a fresh checkout to a first ranked job report. It deliberately begins
without Gmail or SMTP; those integrations can be added after the core loop works.

## 1. Install prerequisites

You need Node.js 20 or newer and npm:

```bash
node --version
npm --version
```

For custom careers pages, scraper healing, or Gmail sync, install and authenticate at least one AI
CLI:

```bash
claude --version
# or
codex --version
```

The core Tier-1 ATS adapters work without AI. See [AI providers and Gmail](ai-and-gmail.md) when you
are ready to configure those features.

## 2. Build and link employed

From the repository root:

```bash
npm install
npx playwright install chromium
npm run build
npm link
employed --version
```

`npm link` makes the `employed` command available in your shell. If global linking is blocked by a
root-owned npm prefix, use a writable prefix:

```bash
npm config set prefix "$HOME/.local"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
npm link
```

## 3. Initialize your workspace

```bash
employed init
```

Initialization creates `~/.employed`, writes the three commented YAML files, creates `reports/` and
`logs/`, migrates SQLite, and validates the templates. It is idempotent: rerunning it fills missing
files but does not overwrite your edits.

Confirm the installation:

```bash
employed doctor
```

Warnings about Gmail, SMTP, the scheduler, or a missing AI provider are expected until those
optional integrations are configured.

## 4. Add your first company

The quickest path is an individual careers URL:

```bash
employed company add "Highspot" \
  --url https://jobs.lever.co/highspot \
  --tier A
```

Then inspect the registry:

```bash
employed company list
```

Tier A means check every daily run. Tier B and C reduce how frequently expensive boards are checked.
See [Job discovery and scoring](job-discovery.md) for the exact behavior.

To manage several companies, edit `~/.employed/companies.yaml` and run:

```bash
employed import ~/.employed/companies.yaml
```

## 5. Scan and inspect jobs

```bash
employed scan --company "Highspot"
```

The scan detects the ATS, fetches postings, normalizes and deduplicates them, scores them using
`keywords.yaml`, and stores them in SQLite. New rows appear ordered by score with their A–D band.

Generate today's report:

```bash
employed new
employed new --band A,B
employed new --json
```

Every invocation also writes `~/.employed/reports/YYYY-MM-DD.md`. JSON mode emits only JSON, which
is useful for scripts and dashboards.

## 6. Run the full daily loop

```bash
employed run --no-ai
```

This checks the companies scheduled for the current run, scores new jobs, closes postings missing
from consecutive successful scans, records run statistics, and writes the report. Remove `--no-ai`
after an AI provider is configured.

Your next steps:

- Tune [configuration](configuration.md) and [job scoring](job-discovery.md).
- Configure [daily scheduling and email delivery](daily-operation.md).
- Add [Gmail sync](ai-and-gmail.md).
- Track applications using the [CRM workflow](application-tracking.md).
