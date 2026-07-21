# Troubleshooting

Start with:

```bash
employed doctor
```

Doctor is read-only and provides corrective actions. Use the sections below for additional context.

## `employed: command not found`

Build and link from the repository:

```bash
npm run build
npm link
```

Check npm's executable directory:

```bash
npm config get prefix
ls "$(npm config get prefix)/bin"
echo "$PATH"
```

If the prefix is `/Users/you/.local`, add `/Users/you/.local/bin` to `PATH`. If `/usr/local` is
root-owned, use a writable prefix instead of running the project as root:

```bash
npm config set prefix "$HOME/.local"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
npm link
```

## Claude or Codex says “binary not found on PATH”

Test the shell itself:

```bash
command -v claude
command -v codex
claude --version
codex --version
```

If `command -v` prints nothing, the CLI is not installed at any directory on `PATH`. Adding an npm
prefix to `PATH` does not install the package. Install/authenticate the intended CLI, reopen the
shell, and rerun doctor. Scheduled jobs may have a smaller `PATH` than your interactive shell; the
schedule captures the absolute Node/script paths, but provider binaries must still be discoverable.

## Configuration will not load

Errors include the file path and failing field. Common fixes:

- Use `HH:MM`, such as `07:00`, for run time.
- Keep concurrency in the 1–10 range.
- Ensure `jitterMs.min` is not greater than `max`.
- Do not repeat providers in `ai.preference`.
- When email is enabled, fill `to`, `from`, SMTP host, port, and user.
- Export `EMPLOYED_SMTP_PASSWORD` before loading enabled email configuration.

If files are missing:

```bash
employed init
```

Initialization does not overwrite existing edits.

## Plaintext SMTP password is rejected

The file must be owner-only:

```bash
chmod 600 ~/.employed/config.yaml
```

The safer fix is to remove `smtp.password` and export `EMPLOYED_SMTP_PASSWORD`.

## SMTP verification or delivery fails

```bash
export EMPLOYED_SMTP_PASSWORD="your-app-password"
employed doctor
```

Check host, port, sender, recipient, user, network access, and whether the provider requires an app
password. Port 465 uses secure SMTP. Email failure never deletes the report; open the path printed by
the run under `~/.employed/reports`.

## Gmail MCP is not found

Doctor checks the active provider, not every configured provider. Confirm the active marker in the
AI table, then configure Gmail for that CLI:

```bash
claude mcp add gmail -- <YOUR_GMAIL_MCP_COMMAND>
```

Or add `[mcp_servers.gmail]` to `~/.codex/config.toml`. Authenticate the MCP server separately.
If preference selects the wrong CLI, edit `ai.preference`.

## A company remains unknown or untested

```bash
employed company list
employed scan --company "Company Name"
```

For a custom page with an active AI provider:

```bash
employed company generate "Company Name"
```

Unknown can mean the URL is not a supported ATS, robots.txt denied detection, the page needs
rendering, the URL redirected unexpectedly, or the AI provider was unavailable.

## A scraper is degraded or broken

One failure becomes degraded and intentionally does not repair immediately. A consecutive failure
can trigger bounded healing during `run`. For immediate investigation:

```bash
employed scan --company "Company Name"
employed company generate "Company Name"
employed doctor
```

ATS companies may have migrated providers. Generated pages may have changed selectors or rendering
behavior. Browser-backed repair requires Chromium:

```bash
npx playwright install chromium
```

## A company needs manual review

`manual-review` means every bounded plan attempt failed; it is not a silent dead end. Run doctor,
then open the newest matching directory:

```bash
employed doctor
ls -lt ~/.employed/debug
```

The bundle contains `captured.html`, `network.txt`, `attempts.json`, and `navigation.json`. Check
whether the page is authentication/captcha protected (leave it manual), whether `network.txt`
reveals a same-domain jobs endpoint suitable for an API plan, or whether the company is actually a
known ATS that should be pinned in `known_ats.yaml`. After correcting the cause, rerun `employed
company generate "Company Name"`.

## Playwright/Chromium errors

Install the browser version matching the package:

```bash
npx playwright install chromium
```

Static and known ATS scans do not launch Chromium. Check `run.playwright.navTimeoutMs` before raising
it; persistent timeouts often indicate authentication, bot protection, or a wrong careers URL.

## The run says another run holds the lock

Only one run is allowed. If that process is still alive, let it finish. Employed automatically
reclaims locks whose PID no longer exists. If the message persists, inspect `~/.employed/run.lock`
and running processes before removing anything; do not delete a lock belonging to a live run.

## Scheduled runs do not fire

```bash
employed schedule status
employed doctor
```

On macOS, inspect `~/Library/LaunchAgents/com.employed.daily.plist` and logs under
`~/.employed/logs`. A sleeping laptop fires launchd work after waking. On Linux, inspect `crontab -l`.
Scheduled environments may lack your interactive `PATH` or SMTP password export.

## Scores look wrong

Read `keywords.yaml`, remember the structural multipliers (title ×2, description ×1, negative ×−2),
and note that matching is word-boundary-aware, not raw substring — `ai` matches "AI Engineer" but
not "domain" or "maintaining". Then run:

```bash
employed rescore
```

Title-only jobs have no description evidence and are explicitly marked. `rescore`'s output reports
how many jobs' bands moved up or down, so you can confirm a weight edit had the expected effect.

## A job I expected is missing from the report

Check whether it scored too low for the band you're viewing (`employed new --band C,D` widens the
view), or whether it was auto-filtered. `hardExclude`/`locations` in `keywords.yaml` remove a
matching job from reports entirely, distinct from a low score:

```bash
employed new --show-filtered
```

This lists today's auto-filtered jobs with the specific reason each was excluded (for example
`hard-exclude title: senior` or `location blocked: india`). If the filter is too aggressive, undo
it for one job with `employed restore JOB_ID` — this only works on system-filtered jobs, not ones
you dismissed yourself with `employed dismiss`. See
[Job discovery](job-discovery.md#auto-filtered-jobs) for the full behavior.

## Gmail sync repeats or misses mail

Processed thread IDs are ledgered and intentionally skipped on later syncs. Increase the initial
window if needed:

```bash
employed sync --days 90
```

Cron automatically applies only high-confidence updates to existing applications. Run interactive
sync for deferred/ambiguous proposals. AI-free mode cannot retrieve Gmail.

## Import fails or reports conflicts

Always start with:

```bash
employed import-hq backup.json --dry-run
```

A native snapshot identity conflict means the destination already has a different row using an
imported ID. Restore native backups into a fresh workspace, or export and preserve the destination
before deciding how to reconcile. Malformed HQ records need a company and seen records need a thread
ID. Existing application/company-role matches are skipped by design.

## Database integrity problems

First make a filesystem copy of `~/.employed`, then inspect:

```bash
sqlite3 ~/.employed/employed.db "PRAGMA integrity_check;"
```

Do not attempt ad hoc destructive repairs without a backup. A versioned JSON export is useful when
the database remains readable:

```bash
employed export --out employed-backup.json
```

## Get clean diagnostic output

```bash
employed doctor --no-animation
employed doctor --strict --no-animation
```

Use `--no-animation` for bug reports and logs. `--verbose` can add HTTP cache diagnostics when
investigating fetch behavior.
