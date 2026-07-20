## Layer 2, Unit 1: SQLite Layer — Schema, Migrations, Typed Data Access

**What this is:** The persistence foundation. Every feature after this reads or writes the database, so the pattern here — repository classes over raw SQL, migrations from day one — determines whether adding/removing features later is a file-level change or surgery across the codebase.

---

**Deliverables:**

**New dependency:** `better-sqlite3` (+ `@types/better-sqlite3`).

**`src/db/schema.sql`** — The full schema from the spec (§6), verbatim: `companies`, `jobs`, `applications`, `events`, `email_threads`, `runs`, `claude_cache` — with one rename given the provider-flexibility direction: call the cache table `ai_cache` now (columns identical). All seven tables ship in migration 1 even though early units only touch `companies` and `jobs` — schema churn is more expensive than unused tables, and the spec's schema is settled.

**`src/db/migrate.ts`** — A minimal, forward-only migration runner using SQLite's `user_version` pragma:

```typescript
const migrations: Migration[] = [
  { version: 1, up: (db) => db.exec(readFileSync(SCHEMA_SQL_PATH, "utf8")) },
  // future: { version: 2, up: (db) => db.exec("ALTER TABLE ...") }
];
export function migrate(db: Database): void; // runs pending migrations in a transaction each
```

Rules: each migration runs inside a transaction; `user_version` is bumped only on success; the runner is idempotent (safe to call on every startup, which is exactly what we'll do). No down-migrations — for a local single-user app, rollback is "restore the file," and down-migrations are maintenance burden that rots.

**`src/db/connection.ts`** — A `createDb(path?)` factory: opens the file (defaulting to `DB_PATH` from constants, injectable path for tests — `:memory:` makes the entire test suite need zero disk), sets pragmas (`journal_mode = WAL`, `foreign_keys = ON` — better-sqlite3 does _not_ enable FK enforcement by default, and our schema depends on it), then calls `migrate()`. One connection per process, created in cli.ts, added to `CommandContext`.

**`src/db/types.ts`** — Row types for every table (`CompanyRow`, `JobRow`, ...) plus the enums as string-literal unions (`Tier = 'A'|'B'|'C'`, `ScrapeMethod`, `Health`, `JobStatus`, `AppStatus`, `EventType`, `Band`). These are the _canonical domain types_ for the whole app — the scraper, scorer, and report units all import from here. One place, one truth.

**`src/db/repositories/`** — The data-access pattern, one repository class per aggregate:

```
repositories/
  companies.ts    # CompanyRepository
  jobs.ts         # JobRepository
  index.ts        # Repositories bundle: { companies, jobs } — grows per unit
```

Only these two repositories are implemented now (they're what Units 3+ need); `applications`, `runs`, etc. get their repositories in the units that use them — the _pattern_ is established here, the coverage grows just-in-time.

Each repository: constructor takes the `Database`, prepares its statements once (better-sqlite3's prepared statements are the performance model — prepare in constructor, run in methods), exposes intent-named methods, and **is the only place SQL strings exist** for its tables. Commands and services never see SQL.

`CompanyRepository`: `insert(input): CompanyRow`, `findByName`, `list()`, `updateMethod(id, method, slug?, config?)`, `updateHealth(id, health)`, `recordSuccess(id, yieldCount)`, `recordFailure(id)` (increments `consecutive_failures`).

`JobRepository`: `upsert(input): { job: JobRow, isNew: boolean }` — implements the §5 dedupe contract in one place: `INSERT ... ON CONFLICT(company_id, dedupe_key) DO UPDATE SET last_seen = excluded.last_seen`, with `isNew` derived from whether the insert took. Also `findNewSince(date)`, `markClosedIfUnseen(companyId, runDate)` (the 2-consecutive-runs lifecycle rule lands in the scrape unit — stub the signature now), `dismiss(id)`.

**`src/db/index.ts`** — Public surface of the whole layer: `createDb`, `Repositories`, row types. The rest of the app imports `@/db` and nothing deeper — internal file layout stays refactorable.

**Architectural decisions to enforce:**

- **Repository owns SQL; service owns rules; command owns orchestration.** The dedupe key _computation_ (`sha256(normalizedTitle + urlPath)`) does NOT live in the repository — that's domain logic and belongs to the normalize unit later. The repository receives a computed `dedupe_key` and enforces uniqueness. Keep this boundary crisp.
- **Everything injectable.** `createDb(':memory:')` + `new Repositories(db)` must fully wire the persistence layer in a test with no filesystem. This is the payoff of the factory/DI discipline from Units 1–2.
- **Transactions at the service layer**, not inside repositories — a future scrape run wraps "upsert 200 jobs" in one transaction spanning repository calls. Expose `withTransaction<T>(fn): T` from `connection.ts` (wrapping better-sqlite3's `db.transaction`) so services can do this without touching the driver.

**Acceptance criteria:**

- `employed init` now also creates and migrates the DB (extend init's step list); running init twice is still idempotent, `user_version` stays 1
- Fresh DB has all 7 tables, `foreign_keys` pragma ON, WAL mode active
- `CompanyRepository.insert` + `findByName` round-trip on `:memory:`
- `JobRepository.upsert` called twice with the same `(company_id, dedupe_key)` returns `isNew: true` then `isNew: false`, and `last_seen` updates while `first_seen` doesn't
- Inserting a job with a nonexistent `company_id` throws (proves FK enforcement)
- A deliberately failing migration in a test leaves `user_version` unbumped and the DB unchanged (transaction rollback proven)

## Layer 1, Unit 2: Config System + `employed init`

**What this is:** The configuration foundation and the first real command. Every future unit reads config — so the pattern established here (schema-validated, typed, single source of truth) is what keeps the app maintainable when there are 15 commands all needing settings. `init` is also the first consumer of the command-registration pattern from Unit 1, proving it works.

---

**Deliverables:**

**New dependencies:** `zod`, `yaml` (the `yaml` package, not `js-yaml` — better TS types and comment preservation).

**`src/config/schema.ts`** — Zod schemas as the single source of truth for every config file. Types are _derived_ from schemas (`z.infer`), never hand-written in parallel — one definition, validation and types both come from it:

```typescript
export const AppConfigSchema = z.object({
  run: z
    .object({
      time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .default("07:00"),
      concurrency: z.number().int().min(1).max(10).default(4),
    })
    .default({}),
  email: z
    .object({
      enabled: z.boolean().default(false),
      // smtp fields land in the email unit — schema is extended then, not rewritten
    })
    .default({}),
  claude: z
    .object({
      enabled: z.boolean().default(true),
      maxCallsPerRun: z.number().int().default(10),
    })
    .default({}),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
```

Same file: `CompaniesFileSchema` (defaults block + array of `{name, url, tier?}`) and `KeywordsFileSchema` (`title`/`desc`/`negative` as `Record<string, number>`). Every field has a `.default()` — a valid empty file must parse into a fully-populated config object. This is the "defaults live in the schema, nowhere else" rule; no scattered `?? fallback` logic anywhere downstream.

**`src/config/loader.ts`** — A `ConfigService` class (constructor takes a base dir, defaulting to `EMPLOYED_DIR` — injectable for tests):

```typescript
class ConfigService {
  loadApp(): AppConfig;
  loadCompanies(): CompaniesFile;
  loadKeywords(): KeywordsFile;
}
```

Each method: read file → parse YAML → zod validate → return typed object. On validation failure, throw a custom `ConfigError` that includes the file path and a human-readable list of which fields failed and why (map zod issues to `path: message` lines) — the error boundary from Unit 1 renders it. Lazy + memoized per process: parse once, cache the result. Missing file throws `ConfigError` with a hint to run `employed init`.

**`src/config/templates.ts`** — The default file contents `init` writes, as exported string constants. Templates are _commented YAML_ (this is why we chose the `yaml` package) — the companies template shows two example entries commented out, the keywords template ships the full seed profile from the spec (§7.6 values), the config template shows every option with its default and a comment explaining it. The user's first-run experience is editing a self-documenting file.

**`src/commands/init.ts`** — First real command, implementing the `register(program)` interface:

Flow: banner → check if `~/.employed` exists (if fully initialized, say so and exit 0 — idempotent, never clobber user edits) → create directory tree (`reports/`, `logs/`) → write the three template files _only if each is absent_ (per-file check, so a partial init recovers) → validate what was written by immediately loading it through `ConfigService` (proves templates and schemas agree — this catches template/schema drift at dev time, a classic silent-rot bug) → success summary listing what was created vs. skipped.

Each step gets a `ui.spinner()` — this is the first place the animation layer shows off: spinner per step, succeed/fail per step, plain fallback automatic.

**Architectural decisions to enforce:**

- **Commands orchestrate; services do work.** `init.ts` should read as a sequence of calls into `ConfigService` + a small `scaffold` helper — zero YAML parsing, zero schema knowledge inline. This is the layering every future command follows: thin command → fat service.
- **Schema evolution path:** future units _extend_ these zod schemas (`.extend()`, adding optional fields with defaults). Because every field defaults, old config files remain valid as the app grows — forward compatibility by construction, no migration system needed for config (the DB gets migrations; config doesn't need them).
- `ConfigService` is instantiated once in cli.ts alongside the UI and passed to commands (same DI pattern as `ui`). Define a `CommandContext { ui, config }` type in `commands/types.ts` and update the register signature to `register(program: Command, ctx: CommandContext)` — this context object is how every future dependency (db, later) reaches commands without global imports.

**Acceptance criteria:**

- `employed init` on a clean machine creates the full tree + three files, each step animated
- Running it again reports "already initialized," changes nothing (verify by mtime)
- Deleting only `keywords.yaml` and re-running restores just that file
- Hand-corrupting a yaml value (e.g. `concurrency: banana`) and loading produces a `ConfigError` naming the file, the field path, and the expected type — rendered cleanly, not a stack trace
- An empty `config.yaml` parses into the full default object
- Templates round-trip: every generated template passes its own schema

---

Say **next** for Layer 1, Unit 3: the SQLite layer — schema, migrations, and the typed data-access pattern.

## Layer 1, Unit 1: Project Scaffold + CLI Entry Point

**What this is:** The skeleton that every future unit plugs into. No features — just the build system, project structure, and a working `employed` command that does nothing except prove the toolchain works. Since you want animations throughout, we're also establishing the UI abstraction layer _now_ — this is a foundational decision, because if animation calls get scattered inline across 20 command files, you'll never be able to change the visual style, add a `--quiet` flag, or make cron runs animation-free without touching everything.

---

**Deliverables:**

**`package.json`** — TypeScript project with `"bin": { "employed": "dist/cli.js" }`. Package name `employed`. Scripts for `build` (tsc), `dev` (tsx for local iteration), and `lint`. Target ES2022, module NodeNext. Dependencies: `commander`, `chalk`, `ora` (spinners), `nanospinner` optional alternative — pick `ora`, it's the standard. Dev dependencies: `typescript`, `tsx`, `@types/node`. Nothing else yet.

**`tsconfig.json`** — Strict mode on, `outDir: dist`, `rootDir: src`, `declaration: true`. Path alias `@/*` mapped to `src/*` so imports stay clean as the tree grows (`@/db`, `@/ui`, `@/util` — never `../../../../db`).

**`src/cli.ts`** — The single entry point. `#!/usr/bin/env node` shebang. Creates a `commander.Command` instance, sets name/version/description, registers a global `--no-animation` flag, and calls `program.parse()`. No subcommands yet. Top-level error boundary that catches, prints a styled error via the UI layer (not raw chalk), and exits with code 1.

**`src/ui/index.ts` — the UI abstraction layer (the important new piece):**

A single module that owns _all_ terminal output for the entire application. Commands never import `ora` or `chalk` directly — they import `ui`. Interface to define now:

```typescript
interface UI {
  spinner(text: string): Spinner; // start/succeed/fail/update
  success(msg: string): void; // ✓ styled
  error(msg: string): void; // ✗ styled
  warn(msg: string): void;
  info(msg: string): void;
  heading(msg: string): void; // section headers
  banner(): void; // "employed" ASCII/gradient banner on startup
}
```

Two implementations behind a factory: `AnimatedUI` (ora spinners, banner, color) and `PlainUI` (plain line output — used when `--no-animation` is passed, when `!process.stdout.isTTY`, or when `CI`/cron is detected). The factory checks TTY automatically — this matters because your daily scheduled run will pipe to a log file, and animated spinner frames in a log file are garbage. This TTY-detection decision made now saves a painful refactor later.

The `banner()` for this unit can be simple (name + version with chalk styling); a fancier gradient/ASCII treatment is a later polish unit — but the _call site_ exists from day one.

**Directory structure created (empty directories with `.gitkeep`):**

```
src/
  commands/       # one file per command, registered by cli.ts
  ui/             # ALL terminal output lives here
  db/             # schema + data access layer
  scrape/         # adapters, detection, generation
  score/          # scoring engine
  gmail/          # sync logic
  claude/         # runner + prompt management
  report/         # digest/report generation
  config/         # yaml parsing + validation
  util/           # shared helpers
prompts/          # prompt template .txt files
```

**Architectural decisions to enforce:**

Each `commands/` file will export a single function `register(program: Command): void` — cli.ts imports and calls each one. Adding a command never touches cli.ts internals after the registration pattern is wired. Define this interface now in `src/commands/types.ts` even though no commands exist yet.

A `src/constants.ts` defining `EMPLOYED_DIR = path.join(os.homedir(), '.employed')` and all derived paths (`DB_PATH`, `CONFIG_PATH`, `REPORTS_DIR`, `LOGS_DIR`) as constants. Every future module imports paths from here — never constructs them inline.

The UI instance is created once in cli.ts and passed down (or exposed as a singleton via `getUI()`) — commands receive it, they don't construct it. This is dependency inversion: swap `AnimatedUI` for `PlainUI` (or a future test-mock UI) and zero command code changes.

**Acceptance criteria:**

- `npm run build` compiles with zero errors, zero warnings
- `npm link` installs globally; `employed --help` prints name, version, description
- `employed --version` works
- Running `employed` in a TTY shows the banner via `AnimatedUI`
- `employed --no-animation` and `employed | cat` both produce plain output (proving TTY detection works)
- The error boundary catches a thrown error, renders it through `ui.error()`, exits code 1
- Path aliases resolve in both `tsc` and `tsx`
