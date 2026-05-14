# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

Two ways to run the server:

- **From source (fast iteration, tsx watch)**: `dev:mcp`
- **From compiled `dist/` (what Claude Desktop runs)**: `start:mcp` (auto-rebuilds via `prestart:mcp`)

Scripts:

- `npm install` - **ALWAYS run first** to install dependencies
- `npm run dev:mcp` - Run the MCP server from TS source in tsx watch mode
- `npm run start:mcp` - Build and run the MCP server from compiled `dist/`
- `npm run build` - Compile TS to JS in `dist/` (uses `tsconfig.build.json`, excludes tests)
- `npm run typecheck` - Type-check without emitting (`tsc --noEmit`)
- `npm run inspect` - Use MCP Inspector to test the server interactively (runs TS via tsx)
- `npm test` - Run vitest tests (use `npm run test:watch` for watch mode)
- `npm run lint:check` - Lint and format-check TS/JS/JSON with Biome
- `npm run lint:fix` - Auto-fix Biome lint findings (with `--unsafe`) and apply formatting
- `npm run format` - Apply Biome formatting only (no lint)
- `npm run lint:md` - Format and lint markdown files (prettier + markdownlint; Biome doesn't format markdown yet)
- `npm run lint:package` - Format `package.json` with syncpack
- `npm run lint:deps:missing` - Add missing dependencies detected by depcheck
- `npm run lint:deps:unused` - Remove unused devDependencies detected by depcheck
- `npm run update:libs` - Check for outdated packages with npm-check-updates
- `npm run clean` - Remove `dist/` and `node_modules/`

## Architecture Overview

`mcp-git-audit` is a stdio MCP (Model Context Protocol) server that walks a
tree of local git repositories and returns a per-repo status payload (branch,
working-tree state, ahead/behind upstream, last-commit metadata).

The work is **split across two tools** so callers can cache the cheap part and
re-run the expensive part on demand:

- `scan` — pure filesystem walk. Returns repo paths/groups/names. No `git` invocations.
- `audit` — takes a `scan` result and runs the per-repo `git` calls.

Every path the server touches is validated against `MCP_GIT_AUDIT_SAFE_ROOTS`,
including each `abs_path` in a scan result re-supplied to `audit`. A cached
scan **cannot** widen the security boundary.

### Source Layout

The codebase is TypeScript with ES modules (`"type": "module"` in `package.json`). Source lives under `src/`; compiled JS is emitted to `dist/` by `npm run build` (via `tsconfig.build.json`).

- `src/mcp-server/index.ts` - Entry point. Boots the MCP server and calls `registerRepoAuditTools(server)`.
- `src/config.ts` - Loads and parses `MCP_GIT_AUDIT_SAFE_ROOTS` (colon-separated, defaults to `~` when unset or empty); exports the resolved `SAFE_ROOTS` constant.
- `src/utils.ts` - `expandHome`, `resolveAgainstSafeRoots` (the security guard), `errorResult`/`jsonResult` helpers and the `isNodeError`/`errMessage` helpers.
- `src/scan.ts` - Depth-limited repo discovery (`findRepos`) and the public `scanRoot()` that produces a `ScanResult` envelope.
- `src/audit.ts` - Per-repo `git` calls (`auditRepo`) and `auditScan(scan, opts)` which maps a scan into an `AuditResult`. Per-repo failures are caught and aggregated into `errors[]`.
- `src/tools/repo-audit/index.ts` - `registerRepoAuditTools(server)` registers both `scan` and `audit`.
- `src/tools/index.ts` - Barrel re-exporting the register functions (mirrors the sibling MCPs' pattern; new tool groups slot in here).

### Tools Exposed

| Tool | Description |
| --- | --- |
| `scan` | Walk a directory tree for `.git` directories and return repo metadata. Read-only, idempotent, **no `git` calls**. |
| `audit` | Run per-repo `git` checks over a prior scan result. Read-only, idempotent. |

#### `scan` input

| Input | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `root` | string | — | Optional when exactly one entry is configured in `MCP_GIT_AUDIT_SAFE_ROOTS`. Otherwise required, and must equal or live inside one of those entries. |
| `max_depth` | number | 2 | Max depth (from `root`) at which a repo dir may live. |

Output shape: see `README.md` and `src/scan.ts` (`ScanResult` / `ScannedRepo`).

#### `audit` input

| Input | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `scan` | object | — | A previous `scan` result: `{ root, scanned_at, repos: [{ path, abs_path, group, name }] }`. Every `abs_path` is revalidated against `MCP_GIT_AUDIT_SAFE_ROOTS` before any `git` call. |
| `include_stale_days` | number | 30 | Reserved; passed through but currently unused. |

Output shape: see `README.md` and `src/audit.ts` (`AuditResult` / `RepoStatus`). Per-repo failures land in `errors[]` rather than throwing.

### Key Components

- **Safe roots**: `SAFE_ROOTS` is resolved once at module load in `src/config.ts` from `process.env.MCP_GIT_AUDIT_SAFE_ROOTS`. `~` and `~/...` are expanded to the user home dir. Defaults to `[~]` when unset or empty.
- **Path safety**: `resolveAgainstSafeRoots()` in `src/utils.ts` `~`-expands the input, rejects relative paths, calls `fs.realpath` on both the input and every safe root (or, for not-yet-existing paths, the deepest existing ancestor), and verifies containment. Rejects symlink-based escapes that a purely lexical check would miss.
- **Audit revalidation**: the `audit` tool calls `resolveAgainstSafeRoots` for **every** `abs_path` in the supplied scan, before any `git` call. The cache cannot be used to point at paths outside `SAFE_ROOTS`.
- **`git` invocations**: `runGit()` in `src/audit.ts` shells out via `execFile` with `--no-optional-locks`, an 8s timeout, and a bounded `maxBuffer`. Optional commands (upstream presence, ahead/behind counts, branch when detached) go through `tryRunGit()` which swallows errors and returns `null`, so they don't poison the whole result.
- **Repo discovery**: `findRepos()` in `src/scan.ts` does a depth-limited walk; once a `.git` directory is found we record the parent and do **not** recurse further. Worktree-pointer `.git` files are skipped for v1. Hidden directories and `node_modules` are pruned.
- **Output shape**: `auditScan()` returns `{ root, scanned_at, audited_at, repos[], errors? }`. Repos are sorted by group then name. The `errors[]` key is omitted entirely when every repo audits cleanly. The shape is a contract with downstream consumers — do not change without updating them.
- **Error shape**: Tool errors return `{ isError: true, content: [{ type: 'text', text }] }` via `errorResult()`. Successful tools return JSON via `jsonResult()`.
- **Transport**: `StdioServerTransport` from `@modelcontextprotocol/sdk`. Logs go to stderr (`console.error`) so they don't pollute the stdio MCP channel.

## Configuration

### Environment Variables

- `MCP_GIT_AUDIT_SAFE_ROOTS` (optional) - Colon-separated list of absolute or
  `~/...` paths the tool is allowed to walk. Multiple entries are supported.
  Defaults to `~` (the user's home directory) when unset or empty. Tool calls
  must target a path equal to or inside one of these entries.

Convention: `src/config.ts` calls `process.loadEnvFile('./.env.${NODE_ENV}')`
at startup (try/caught), so the `dev:mcp` and `inspect` scripts pick up
`.env.development` from the CWD. In production (Claude Desktop) `NODE_ENV` is
unset and the env comes from the Desktop config `env` block.

## Common Setup Issues

1. **Missing dependencies**: Run `npm install` first.
2. **"root is not inside any configured safe_root"**: the supplied `root` (or
   an `abs_path` in `scan.repos`) is outside every entry in
   `MCP_GIT_AUDIT_SAFE_ROOTS`. Either add it to the env var (colon-separated)
   or call with a path that lives inside an existing safe root.
3. **No repos discovered**: confirm `max_depth` is large enough — by default
   `scan` only walks two levels under `root`.

## Error Handling

- Path escapes safe roots: `root "<X>" is not inside any configured safe_root (...)`
- Relative `root`: `root must be an absolute path or start with ~/: "<X>"`
- `root` omitted with multiple safe roots: `root is required when multiple safe_roots are configured (...)`
- Per-repo failures appear in the response's `errors[]` array; the rest of the audit succeeds.
- All other errors are surfaced as `Error scanning: <message>` or `Error auditing: <message>` via `errorResult()`.
