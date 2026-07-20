# Configuration

Configuration is YAML under `~/.employed` unless `EMPLOYED_DIR` points elsewhere. Defaults live in
the validation schemas, so omitted fields receive stable defaults and older files remain valid.

## `config.yaml`

### Run and HTTP behavior

```yaml
run:
  time: "07:00"
  concurrency: 4
  jitterMs:
    min: 500
    max: 1500
  maxRetries: 3
  respectRobots: true
  autoGenerateOnAdd: true
  heal:
    maxPerCompany: 2
    maxPerRun: 5
  playwright:
    navTimeoutMs: 30000
```

- `time` is the default local scheduling time in `HH:MM` format.
- `concurrency` limits simultaneous company work to 1–10.
- `jitterMs` adds a polite randomized delay for requests to the same domain.
- `maxRetries` bounds retryable HTTP attempts.
- `respectRobots` controls robots.txt enforcement for non-API page detection.
- `autoGenerateOnAdd` asks AI to generate a scraper when detection finds no supported ATS.
- `heal.maxPerCompany` and `heal.maxPerRun` bound automated repair cost in one run.
- `playwright.navTimeoutMs` is the hard rendered-page navigation/selector timeout.

### AI providers

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

`preference` is ordered fallback: the first enabled and installed provider is active. Entries must
be unique. `maxCallsPerRun` is shared by generation, healing, Gmail retrieval/classification, and
other AI work. Setting `ai.enabled: false` preserves all deterministic features.

### SMTP email

```yaml
email:
  enabled: false
  to: ""
  from: ""
  smtp:
    host: smtp.gmail.com
    port: 465
    user: ""
```

When enabled, all addresses and SMTP fields are required. Export the preferred credential before
running or scheduling employed:

```bash
export EMPLOYED_SMTP_PASSWORD="your-app-password"
```

The optional plaintext `smtp.password` fallback requires `chmod 600 ~/.employed/config.yaml`.
The environment variable wins when both exist.

### Analytics thresholds

```yaml
stats:
  followUpDays: 7
  staleDays: 21
  minKeywordSample: 2
  minResumeSample: 3
```

- Active applications quiet for `followUpDays` appear as follow-up nudges.
- At `staleDays`, they move to the stronger stale list.
- Keyword correlations below `minKeywordSample` applications are hidden as noise.
- Résumé groups below `minResumeSample` are shown as low-signal.

## `companies.yaml`

```yaml
defaults:
  tier: B

companies:
  - name: Example Company
    url: https://example.com/careers
    tier: A
  - name: Another Company
    url: https://example.org/jobs
```

Names should be stable and unique. URLs must be public HTTP(S) careers pages. An omitted tier uses
`defaults.tier`. Apply edits to the database with:

```bash
employed import ~/.employed/companies.yaml
```

Import is non-aborting: one invalid entry is reported without preventing valid entries from being
processed. Existing company names are skipped rather than duplicated.

## `keywords.yaml`

```yaml
title:
  new grad: 6
  software engineer: 5
description:
  typescript: 3
  python: 3
negative:
  senior: 8
  5+ years: 6
```

Matching is case-insensitive substring matching. Contributions are:

```text
2 × sum(title weights)
+ 1 × sum(description weights)
- 2 × sum(negative weights found in title or description)
```

After editing weights, update existing open jobs without network access:

```bash
employed rescore
```

## Temporary and multiple workspaces

Every path derives from `EMPLOYED_DIR`:

```bash
export EMPLOYED_DIR="/path/to/workspace"
employed init
```

For a disposable test:

```bash
export EMPLOYED_DIR="$(mktemp -d)"
employed init
# test commands
rm -rf "$EMPLOYED_DIR"
unset EMPLOYED_DIR
```

Do not delete a non-temporary workspace without first making a JSON backup.
