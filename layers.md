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
