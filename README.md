A command-line application that runs a personal job-search operation on autopilot.

## Development setup

```bash
npm install
npx playwright install chromium
npm run build
```

Chromium is downloaded separately from the Playwright package. It is launched lazily only when a
company requires client-side rendering; static and Tier-1 ATS scans do not start a browser.

## Email digest setup

The daily Markdown report is always written to `~/.employed/reports`. SMTP delivery is an additive
copy of that same report, so an email outage never discards the local artifact or fails the run.

Edit `~/.employed/config.yaml`:

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

Use an SMTP app password, not your account password. The recommended credential path keeps the
secret out of YAML:

```bash
export EMPLOYED_SMTP_PASSWORD="your-app-password"
employed doctor
employed run --email
```

Add the export to the environment used by your scheduler if scheduled runs should send mail. The
environment variable takes precedence over any configured password.

As a local-only fallback, `email.smtp.password` is supported in `config.yaml`. This stores plaintext,
so employed refuses to load it unless the file is owner-only:

```bash
chmod 600 ~/.employed/config.yaml
```

Run `employed doctor` to inspect AI providers, Gmail MCP configuration, SMTP reachability, scraper
fleet health, database integrity, the latest run, and scheduler installation. Diagnostic warnings
exit successfully; `employed doctor --strict` exits nonzero when a red problem is present.
