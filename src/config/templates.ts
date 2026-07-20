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

email:
  # Email integration is configured in a later layer.
  enabled: false

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

/** Authoritative §7.6 keyword profile used to score job relevance. */
export const KEYWORDS_TEMPLATE = `# Weighted phrases used by the scoring layer.
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
`;
