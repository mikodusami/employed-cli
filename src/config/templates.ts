/** Self-documenting YAML templates written during first-run initialization. */

/** Default main application configuration. */
export const APP_CONFIG_TEMPLATE = `# employed application settings
run:
  # Daily run time in 24-hour HH:MM format.
  time: "07:00"
  # Maximum companies checked simultaneously (1-10).
  concurrency: 4
  # Random delay range between requests to the same domain.
  jitterMs:
    min: 500
    max: 1500
  # Total attempts for retryable HTTP failures.
  maxRetries: 3
  # Honor robots.txt while detecting non-API careers pages.
  respectRobots: true
  # Generate a static scraper after adding an otherwise unsupported careers page.
  autoGenerateOnAdd: true
  # Bound automatic scraper repairs per company and across one run.
  heal:
    maxPerCompany: 2
    maxPerRun: 5
  # Hard timeout for rendered page navigation and selector waits.
  playwright:
    navTimeoutMs: 30000

# Absolute deadlines for careers-page evidence capture.
capture:
  staticDeadlineMs: 45000
  playwrightDeadlineMs: 90000

# AI planning attempts allowed for one company before manual review.
generate:
  maxAttempts: 4

# Remove command logs older than this many days when a logger starts.
logging:
  retentionDays: 14

email:
  # Send the daily report after an employed run.
  enabled: false
  to: ""       # digest recipient
  from: ""     # sender address, usually the SMTP user
  smtp:
    host: smtp.gmail.com
    port: 465
    user: ""   # Gmail address or SMTP username
    # Preferred: export EMPLOYED_SMTP_PASSWORD="your-app-password"
    # password: "" # plaintext fallback; employed enforces config.yaml mode 600

# AI provider settings. employed shells out to an installed AI CLI
# (Claude Code or OpenAI Codex) for scraper generation, email
# classification, and digest summaries. It never stores API keys —
# each provider CLI manages its own auth (Claude subscription /
# ChatGPT plan or OpenAI API key).
ai:
  enabled: true               # master switch; false = run fully AI-free
  preference: [claude, codex] # try in this order; first enabled+installed wins
  providers:
    claude:
      enabled: true           # requires Claude Code installed (\`claude\` on PATH)
    codex:
      enabled: true           # requires Codex CLI installed (\`codex\` on PATH)
  maxCallsPerRun: 10          # hard budget per run across all AI tasks

# Thresholds used by \`employed stats\` for follow-up nudges and low-sample flags.
stats:
  followUpDays: 7      # applications quiet this long (and still active) get a nudge
  staleDays: 21        # applications quiet this long are flagged stale instead
  minKeywordSample: 2  # a keyword needs at least this many linked applications to be shown
  minResumeSample: 3   # a résumé version needs at least this many applications to not be low-signal
`;

/** Default company watch-list configuration with commented examples. */
export const COMPANIES_TEMPLATE = `# Companies whose career pages employed should monitor.
defaults:
  # Used when an entry does not specify its own tier.
  tier: B

companies: []
  # - name: Example Company
  #   url: https://example.com/careers
  #   tier: A
  # - name: Another Company
  #   url: https://example.org/jobs
`;

/** Optional, manually verified ATS mappings that bypass network detection. */
export const KNOWN_ATS_TEMPLATE = `# Optional ATS overrides, keyed by lowercase company name.
# Overrides are checked before any HTTP request.
# airbnb:
#   method: greenhouse
#   slug: airbnb
{}
`;

/** Authoritative §7.6 keyword profile used to score job relevance. */
export const KEYWORDS_TEMPLATE = `# Weighted phrases used by the scoring layer.
# Matching is case-insensitive and word-boundary-aware (a whole-word/whole-phrase match, not a
# raw substring) — so "ai" fires on "AI Engineer" but not inside "maintaining" or "domain".
title:
  new grad: 6
  software engineer: 5
  entry level: 5
  early career: 5
  junior: 4
  engineer i: 4
  associate: 3
  2026: 3
  full stack: 3
  backend: 3
  product: 2
  frontend: 2
  # Some companies signal early-career eligibility indirectly rather than stating "new grad" —
  # these phrases catch that. Add more as you notice postings that scored lower than they should
  # have.
  new college grad: 6
  university grad: 5
  recent graduate: 5
  class of 2026: 5

description:
  python: 3
  typescript: 3
  react: 3
  java: 2
  node: 2
  aws: 2
  api: 2
  sql: 2
  ai: 2
  machine learning: 2
  mentorship: 2
  docker: 1
  ci/cd: 1
  # Indirect early-career signals (see the note under "title" above).
  equivalent practical experience: 3
  bachelor's degree: 2
  0-2 years: 3
  no experience required: 3
  new grad program: 4

negative:
  10+ years: 10
  unpaid: 10
  senior: 8
  staff: 8
  principal: 8
  director: 8
  7+ years: 8
  5+ years: 6
  security clearance: 6
  phd required: 6

# Hard exclusions: any match removes the job from reports entirely
# (distinct from "negative" above, which only lowers score/band).
# Auto-filtered jobs are still stored (for dedupe/history/retuning) but marked dismissed with a
# reason; review with \`employed new --show-filtered\`, undo one with \`employed restore <jobId>\`.
hardExclude:
  title:
    - senior
    - staff
    - principal
    - director
    - "10+ years"
    - "7+ years"
  description:
    - "phd required"
    - "security clearance"

# Location gate. Leave "allow" empty to permit any location; fill it in
# to restrict. "block" always wins over "allow".
locations:
  allow: []              # e.g. ["united states", "usa", "remote"]
  block: []               # e.g. ["india", "united kingdom"]
  allowUnknownLocation: true   # jobs with no location field are kept, not excluded
`;
