# AI providers and Gmail

Employed shells out to Claude Code or OpenAI Codex. It does not call model APIs directly or store AI
API keys. Each CLI owns its authentication, and provider preference is configurable.

## Install and verify providers

Verify binaries in the same shell that will run employed:

```bash
command -v claude
claude --version

command -v codex
codex --version
```

If npm uses a custom prefix, its `bin` directory must be on `PATH`:

```bash
npm config get prefix
export PATH="$(npm config get prefix)/bin:$PATH"
```

Persist that export in `~/.zshrc` or the startup file used by your shell. A prefix on `PATH` does not
install a CLI; `command -v` must print an actual executable path.

Run:

```bash
employed doctor
```

Doctor shows enabled, installed, version, and active state for each provider.

## Preference, fallback, and budget

In `config.yaml`:

```yaml
ai:
  enabled: true
  preference: [claude, codex]
  providers:
    claude:
      enabled: true
    codex:
      enabled: true
  maxCallsPerRun: 10
```

The runner tries enabled providers in preference order. A missing, failed, or timed-out provider can
fall back to the next. Cache keys include the provider, so responses never cross provider boundaries.
Malformed JSON gets one correction attempt. The per-run budget counts actual provider calls; cache
hits are free.

Disable all AI globally with `ai.enabled: false`, disable one provider under `providers`, or disable
AI for one daily execution with `employed run --no-ai`.

## What AI is used for

- producing data-only scraper configurations for unknown careers pages
- regenerating broken custom scraper configurations
- Gmail MCP retrieval
- classifying the low-confidence tail of application emails

Scoring, Tier-1 ATS scraping, reports, CRM operations, statistics, exports, and scheduling are not AI
tasks.

## Gmail MCP setup

Employed delegates Gmail access to the active CLI's MCP server. It never stores Google credentials.

For Claude Code:

```bash
claude mcp add gmail -- <YOUR_GMAIL_MCP_COMMAND>
```

For Codex, add to `~/.codex/config.toml`:

```toml
[mcp_servers.gmail]
command = "<YOUR_GMAIL_MCP_COMMAND>"
args = []
```

Replace the placeholder with the launch command documented by your chosen Gmail MCP server, then
complete that server's Google authentication. Run `employed doctor`; the Gmail section checks the
active provider's configuration for the server.

## Interactive synchronization

Search the last 30 days by default:

```bash
employed sync
```

Or choose a window:

```bash
employed sync --days 7
```

The pipeline is:

1. The active AI CLI uses Gmail MCP to return bounded email metadata.
2. The local email-thread ledger removes already processed threads.
3. Deterministic rules classify confident confirmations, OAs, interviews, offers, and rejections.
4. Only low-confidence metadata is sent through the AI classifier.
5. Company and role extraction resolves the target application.
6. Interactive mode displays proposals and lets you select changes.
7. Every processed thread is ledgered so repeated syncs are idempotent.

Accepted changes route through the same application transition service as manual commands, so the
event history remains complete.

## Cron synchronization

The daily run uses a two-day Gmail window when AI is available. It automatically applies only
high-confidence rule-based updates to an already existing application. Low-confidence or
record-creating proposals are deferred instead of silently changing the CRM.

Gmail failure never aborts the daily run. Run `employed sync` interactively to investigate.

## Privacy boundaries

- Google OAuth credentials remain inside the MCP server/provider CLI.
- Employed stores thread IDs and classification results for idempotency.
- The classifier receives sender, subject, date, and snippet metadata rather than entire mailboxes.
- Public scraper generation receives distilled careers-page DOM, not browser profiles or private
  account data.
