## Layer 1, Unit 1 — Project scaffold and CLI entry point

Run these flows from the repository root after `npm install` and `npm run build`.

### Flow 1: Discover the CLI

1. Run `employed --help`.
2. Confirm the heading is `Usage: employed [options]`.
3. Confirm the description and the `--version`, `--no-animation`, and `--help` options appear.

### Flow 2: Check the installed version

1. Run `employed --version`.
2. Confirm the only output is `0.1.0`.

### Flow 3: Start interactively

1. Run `employed` in an interactive terminal.
2. Confirm the styled `employed v0.1.0` banner appears.
3. Confirm the command exits successfully.

### Flow 4: Disable animation explicitly

1. Run `employed --no-animation`.
2. Confirm the plain `employed v0.1.0` banner appears without animated terminal frames.

### Flow 5: Redirect output for automation

1. Run `employed | cat`.
2. Confirm the output is a clean `employed v0.1.0` line with no spinner control characters.

### Flow 6: Exercise the development entry point

1. Run `npm run dev -- --version`.
2. Confirm the TypeScript source runs directly and prints `0.1.0`.

### Flow 7: Link the command locally

1. Run `npm link` (use a user-writable npm prefix if the global npm directory is protected).
2. Run `employed --help`.
3. Confirm the installed command shows the same help text as Flow 1.

## Layer 2 — Configuration and SQLite persistence

Run these flows after `npm run build`. They operate on `~/.employed`; back up that directory first
if it already contains data you care about.

### Flow 1: Initialize a fresh workspace

1. Run `employed init --no-animation`.
2. Confirm the command reports valid configuration and database schema version 1.
3. Confirm `~/.employed` contains `config.yaml`, `companies.yaml`, `keywords.yaml`, `employed.db`,
   `reports/`, and `logs/`.
4. Open the YAML files and confirm their comments explain the available settings.
5. Confirm `keywords.yaml` includes `new grad: 6`, `machine learning: 2`, and
   `phd required: 6` in their respective title, description, and negative lists.
6. Confirm `config.yaml` contains `ai.provider: claude` and documents `claude`, `codex`, and
   `chatgpt` as valid provider values.

### Flow 2: Prove initialization is idempotent

1. Add a comment to `~/.employed/config.yaml`.
2. Run `employed init --no-animation` again.
3. Confirm it says the workspace is already initialized and no files were changed.
4. Confirm your added comment is still present.

### Flow 3: Recover a partially initialized workspace

1. Move one generated YAML file out of `~/.employed` temporarily.
2. Run `employed init --no-animation`.
3. Confirm only the missing file is recreated and the other two are reported as preserved.
4. Restore your original file if it contained edits you want to keep.

### Flow 4: See an actionable validation error

1. Set `run.concurrency` to `99` in `~/.employed/config.yaml`.
2. Run `employed init --no-animation`.
3. Confirm the error names `config.yaml`, identifies `run.concurrency`, and exits unsuccessfully.
4. Restore concurrency to a value from 1 through 10 and rerun init successfully.

### Flow 5: Run the automated persistence contract

1. Run `npm test`.
2. Confirm all configuration and SQLite tests pass, including migration rollback, foreign-key
   enforcement, WAL mode, deduplication, memoization, and transaction rollback.

### Flow 6: Reinitialize a pre-reconciliation development database

This flow applies only if you ran Layer 2 before the authoritative §6 schema was supplied.

1. Back up `~/.employed/employed.db` if it contains data you want to inspect later.
2. Move the old database outside `~/.employed`.
3. Run `employed init --no-animation`.
4. Confirm a new database is created at schema version 1.
5. Run `npm test` and confirm all eleven persistence and configuration checks pass.
