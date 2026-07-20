# employed

`employed` is a local-first job-search engine that watches companies you care about, discovers and
scores new roles, and delivers a ranked report within 24 hours of posting. It maintains its scraper
fleet, tracks applications from Gmail or manual commands, and turns the resulting event history into
useful response and interview analytics.

## Prerequisites

- Node.js 20 or newer
- npm
- Claude Code (`claude`) or OpenAI Codex CLI (`codex`) with your own subscription, plan, or API
  access
- Chromium from Playwright when a careers page requires browser rendering

An AI CLI is required for custom scraper generation, self-healing, and Gmail sync. Without one,
employed degrades cleanly: Tier-1 ATS adapters, scoring, reports, CRM commands, and analytics still
work.

## Quick start

```bash
git clone <repository-url> employed-cli
cd employed-cli
npm install
npx playwright install chromium
npm run build
npm link
employed init
```

Edit `~/.employed/companies.yaml`, then run:

```bash
employed import ~/.employed/companies.yaml
employed run
employed new
```

Run `employed doctor` whenever setup is unclear; every problem includes its corrective action.

## Gmail setup

Gmail is delegated through the active AI CLI's MCP configuration. Employed receives email metadata
returned by that CLI and never receives or stores Google OAuth credentials.

For Claude Code, register your Gmail MCP server using its actual launch command:

```bash
claude mcp add gmail -- <YOUR_GMAIL_MCP_COMMAND>
```

For Codex, add the equivalent server to `~/.codex/config.toml`:

```toml
[mcp_servers.gmail]
command = "<YOUR_GMAIL_MCP_COMMAND>"
args = []
```

Authenticate the selected MCP server, then confirm configuration with `employed doctor` and run
`employed sync`. Provider preference lives in `config.yaml` under `ai.preference`.

## Email digest setup

The Markdown report is always written to `~/.employed/reports`; SMTP sends an additive copy. Configure:

```yaml
email:
  enabled: true
  to: you@example.com
  from: you@gmail.com
  smtp:
    host: smtp.gmail.com
    port: 465
    user: you@gmail.com
```

For Gmail, enable two-step verification and create an app password in your Google Account security
settings. Keep that credential out of YAML:

```bash
export EMPLOYED_SMTP_PASSWORD="your-app-password"
employed doctor
employed run --email
```

The environment variable takes precedence. A plaintext `email.smtp.password` fallback is supported,
but employed refuses it unless `config.yaml` is owner-only (`chmod 600 ~/.employed/config.yaml`).

## Scheduling

```bash
employed schedule install --at 07:00
employed schedule status
```

macOS uses launchd, which runs a missed job when the laptop next wakes. Linux uses a managed crontab
line. Logs land in `~/.employed/logs`; remove the schedule with `employed schedule remove`.

## Command reference

- `employed init` — create the local workspace, templates, and database.
- `employed company add/list/generate` — manage and repair watched companies.
- `employed import [companies.yaml]` — import the company watch list.
- `employed scan [--company NAME]` — scrape and score selected companies.
- `employed run [--email] [--no-ai] [--tier A,B]` — execute the full daily loop.
- `employed new [--band A,B] [--json]` — view and export today's ranked jobs.
- `employed rescore` — apply edited keyword weights without scraping.
- `employed sync` — classify Gmail updates and propose CRM changes.
- `employed apply JOB_ID [--resume LABEL]` — track a scraped job application.
- `employed board [--all]` — view the application pipeline.
- `employed app APP_ID` — inspect one application and its event history.
- `employed note APP_ID TEXT` — append an application note.
- `employed move APP_ID STATUS` — record a status transition.
- `employed dismiss JOB_ID` — remove an unwanted job from future reports.
- `employed stats [--json]` — inspect response, interview, résumé, and keyword analytics.
- `employed export [--json|--csv] [--kind applications|jobs] [--out FILE]` — export data.
- `employed import-hq BACKUP.json [--dry-run]` — migrate HQ or native export data safely.
- `employed schedule install/status/remove` — manage the daily OS schedule.
- `employed doctor [--strict]` — diagnose every integration and recorded health signal.

Global flags: `--no-animation` selects log-safe plain output; `--verbose` shows HTTP cache details.

## Configuration

`employed init` creates self-documenting files under `~/.employed`:

- `config.yaml` — scheduling, HTTP, AI, email, browser/healing, and analytics settings
- `companies.yaml` — watched careers pages and tiers
- `keywords.yaml` — title, description, and negative scoring weights

Set `EMPLOYED_DIR` to point all state at another directory, which is useful for isolated testing.

## How it works

```text
OS scheduler / CLI
        |
        v
RunService -> tier scheduler -> ATS adapters or generated scraper configs
        |                            |
        |                            +-> bounded Playwright rendering when required
        |                            +-> detect -> degrade -> regenerate -> validate -> retry
        v
SQLite -> pure scoring engine -> DailyReport model -> terminal / Markdown / SMTP
   |
   +-> append-only application events -> stats
   +-> provider-neutral AI cache

Claude Code or Codex CLI -> scraper generation, healing, and Gmail MCP delegation
```

Known ATS APIs take the cheapest deterministic path. Unknown boards are distilled into bounded
public DOM input, converted by the configured AI provider into data-only scraper configurations,
then executed and validated before persistence. A shared run-scoped browser handles render-only
boards. Repeated failures trigger bounded self-healing; one broken company never aborts the fleet.

AI features depend on a provider-neutral runner with preference fallback, a per-run call budget, and
provider-scoped caching. Reports and analytics use serializable models with pure renderers, while
commands remain thin orchestration over repositories and services.

## Data portability

`employed export --json --out backup.json` creates a versioned, lossless snapshot. Import it into a
fresh workspace with `employed import-hq backup.json`. CSV application/job exports open directly in
spreadsheet tools. HQ migration supports `--dry-run`, preserves newer local records, synthesizes
import-tagged events, and is idempotent.

## Privacy

- State remains in local YAML, SQLite, logs, and reports under `~/.employed`.
- Employed holds no Google OAuth credentials; Gmail access stays inside your AI CLI's MCP server.
- AI providers see distilled public careers-page DOM and limited email metadata, not full inboxes.
- The SMTP app password is the only credential employed reads; the preferred environment path never
  writes it to disk.
- No telemetry service is built in.

## Development

```bash
npm run build
npm run lint
npm test
```

The automated suite is offline by default. Explicit environment flags enable optional live ATS checks.
