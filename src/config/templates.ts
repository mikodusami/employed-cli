/** Self-documenting YAML templates written during first-run initialization. */

/** Default main application configuration. */
export const APP_CONFIG_TEMPLATE = `# employed application settings
run:
  # Daily run time in 24-hour HH:MM format.
  time: "07:00"
  # Maximum companies checked simultaneously (1-10).
  concurrency: 4

email:
  # Email integration is configured in a later layer.
  enabled: false

claude:
  # Allow Claude-assisted processing when that integration is configured.
  enabled: true
  # Safety limit for AI calls during one run.
  maxCallsPerRun: 10
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

/** Starter keyword profile used to score job relevance. */
export const KEYWORDS_TEMPLATE = `# Weighted phrases used by the scoring layer.
title:
  software engineer: 5
  product engineer: 5
  full stack: 4
  backend: 3
  frontend: 3

description:
  typescript: 3
  javascript: 2
  node.js: 2
  react: 2
  distributed systems: 2
  remote: 1

negative:
  unpaid: -10
  internship: -5
  commission only: -10
`;
