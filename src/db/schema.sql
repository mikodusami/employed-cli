PRAGMA user_version = 1;

CREATE TABLE companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  careers_url TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'B',
  scrape_method TEXT NOT NULL DEFAULT 'unknown',
  scraper_config JSON,
  health TEXT NOT NULL DEFAULT 'untested',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_success TEXT,
  last_yield INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  location TEXT,
  department TEXT,
  description TEXT,
  score INTEGER,
  band TEXT,
  matched_kw JSON,
  status TEXT NOT NULL DEFAULT 'open',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  UNIQUE (company_id, dedupe_key)
);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id),
  company_name TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'applied',
  applied_at TEXT,
  resume_version TEXT,
  notes TEXT,
  first_response_at TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  note TEXT
);

CREATE TABLE email_threads (
  thread_id TEXT PRIMARY KEY,
  application_id INTEGER REFERENCES applications(id),
  classified_as TEXT,
  processed_at TEXT NOT NULL
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  companies_scanned INTEGER,
  jobs_seen INTEGER,
  jobs_new INTEGER,
  failures JSON,
  claude_calls INTEGER,
  notes TEXT
);

CREATE TABLE ai_cache (
  key TEXT PRIMARY KEY,
  response JSON NOT NULL,
  created_at TEXT NOT NULL
);
