## Layer 1, Unit 1: Project Scaffold + CLI Entry Point

**What this is:** The skeleton that every future unit plugs into. No features — just the build system, project structure, and a working `employed` command that does nothing except prove the toolchain works.

---

**Deliverables:**

**`package.json`** — TypeScript project with `"bin": { "employed": "dist/cli.js" }`. Scripts for `build` (tsc), `dev` (tsx for local iteration), and `lint`. Target ES2022, module NodeNext. Dependencies: `commander`, `chalk`. Dev dependencies: `typescript`, `tsx`, `@types/node`. Nothing else yet.

**`tsconfig.json`** — Strict mode on, `outDir: dist`, `rootDir: src`, `declaration: true`. Path alias `@/*` mapped to `src/*` so imports stay clean as the tree grows (`@/db`, `@/scrape`, `@/util` — never `../../../../db`).

**`src/cli.ts`** — The single entry point. Creates a `commander.Command` instance, sets name/version/description, and calls `program.parse()`. No subcommands registered yet — that's the next unit's job. Top-level `#!/usr/bin/env node` shebang. Wraps execution in a top-level error boundary that catches, prints a styled error via chalk, and exits with code 1.

**Directory structure created (empty directories with `.gitkeep`):**

```
src/
  commands/       # one file per command, registered by cli.ts
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

Each `commands/` file will export a single function `register(program: Command): void` — cli.ts will import and call each one. This means adding a command never touches cli.ts after the next unit wires up the registration pattern. Define this interface now in `src/commands/types.ts` even though no commands exist yet.

A `src/constants.ts` file defining `employed_DIR = path.join(os.homedir(), '.employed')` and all subdirectory paths (`DB_PATH`, `CONFIG_PATH`, `REPORTS_DIR`, `LOGS_DIR`) as derived constants. Every future module imports paths from here — never constructs them inline.

**Acceptance criteria:**

- `npm run build` compiles with zero errors and zero warnings
- `npm link` installs globally
- `employed --help` prints name, version, description
- `employed --version` prints version from package.json
- `employed anything` prints commander's default unknown-command error
- The error boundary catches a thrown error and exits cleanly
- All path aliases resolve in both `tsc` and `tsx`
