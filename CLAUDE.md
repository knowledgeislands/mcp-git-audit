# CLAUDE.md

Guidance for Claude Code when working in this repo. The user-facing tool surface, install/config, and Claude Desktop setup live in [README.md](./README.md); this file covers what Claude needs that isn't in README and isn't derivable from one grep.

## Bun vs Node

This project uses Bun (≥ 1.3) for install and dev scripts, but the compiled `dist/` runs under Node (≥ 22) — that's what Claude Desktop launches.

- `bun run test` (NOT `bun test` — the latter invokes Bun's own runner instead of vitest).
- Bun auto-loads `.env.${NODE_ENV}` from the CWD; Node needs the explicit `process.loadEnvFile()` call inside `loadConfig()` in [src/config/index.ts](./src/config/index.ts). The try/catch swallows the `TypeError` Bun raises (no `process.loadEnvFile`), so the same code works under both.
- `NODE_ENV` is set to `development` only by `server:mcp:dev` and `server:mcp:inspect`. Claude Desktop doesn't set it, so `.env.*` is ignored in production — `MCP_GIT_AUDIT_SAFE_ROOTS` must come from the Claude Desktop config `env` block.

Run `bun run` with no args for the full script list.

This server targets MCP specification revision **2025-11-25**.

## Architecture Invariants

### Project layout & config injection (the workspace MCP shape)

This is the canonical layout we roll out across the MCPs:

- **[src/config/index.ts](./src/config/index.ts)** — `loadConfig(env?) → Config`. Reads env (optionally hydrated from `.env.${NODE_ENV}`) into a plain `Config` value (`safeRoots`, `accessLevel`, `auditLogMode`, `auditLogPath`, `auditLogMaxBytes`, `auditLogKeep`). **There is no module-level config singleton — nothing reads env at import time.** It also re-exports the shared types/constants (`AccessLevel`, `ACCESS_LEVELS`, `ACCESS_LEVEL_RANK`, `AuditLogMode`).
- **[src/mcp-server/index.ts](./src/mcp-server/index.ts)** — the stdio MCP wrapper. Calls `loadConfig()` once, builds the audit slice, wires `server.registerTool = makeAccessGatedRegister(server, config.accessLevel, audit)`, and threads the `Config` into each `registerXxxTools(server, config)`. Excluded from coverage.
- **[src/tools/](./src/tools/)** — MCP tool definitions only. Thin: validate args (zod), call a `main/` function passing `cfg.safeRoots`, map result/throw to an MCP envelope via `jsonResult`/`errorResult`. `src/tools/**/index.ts` is excluded from coverage — never put logic there.
- **[src/main/](./src/main/)** — the real implementation, usable outside the MCP server (e.g. from a script). Grouped by concern, mirroring the tool groups: `main/repo-audit/` (`scan.ts`, `audit.ts`, `detail.ts` + an `index.ts` re-export), `main/repo-commit/` (`diff.ts`, `commit.ts` + `index.ts`), `main/repo-remotes/index.ts`, `main/repo-sync/index.ts`. Every `main` entry point that touches the filesystem takes `safeRoots: readonly string[]` as its **first argument** — `repoDetail(safeRoots, absPath, opts)`, `diffRepo(safeRoots, …)`, `commitRepo`, `listRemotes`/`setRemoteUrl`/`addRemote`/`removeRemote`, `fetchRepo`/`pullRepo`/`pushRepo`. `scanRoot`/`findRepos`/`auditScan`/`auditRepo` don't touch config and keep their existing signatures.
- **[src/utils/](./src/utils/)** — cross-MCP reusable helpers; keep in sync with sibling repos. These take the **specific config primitive** they need, not the whole `Config`: `resolveAgainstSafeRoots(input, safeRoots)`, `makeAccessGatedRegister(server, accessLevel, audit)`, `withAuditLog(audit, name, level, cb)`, `appendAuditEvent(audit, event)`. `audit` is the `AuditConfig` slice (`{ mode, path, maxBytes, keep }`). `SERVER_NAME` stays `'mcp-git-audit'`.

To use the code from a script: `const cfg = loadConfig(); await diffRepo(cfg.safeRoots, '/abs/repo', { staged: false, max_lines: 500 })`.

### Naming convention

Tool names follow `<app>_<resource>_<action>` (snake_case) with `<app>` = `git`. Plural resource for collection ops, singular for single-item ops. Current surface:

- **repo-audit** (read-only): `git_repos_scan`, `git_repos_audit`, `git_repo_detail`.
- **repo-commit**: `git_repo_diff` (read), `git_repo_commit` (destructive — non-idempotent: writes a new commit each call).
- **repo-remotes**: `git_repo_remotes_list` (read), `git_repo_remote_set_url` (write/idempotent), `git_repo_remote_add` (write/additive), `git_repo_remote_remove` (destructive).
- **repo-sync**: `git_repo_fetch` (write — open-world idempotent), `git_repo_pull` (destructive — open-world), `git_repo_push` (destructive — open-world).

### Access-level gate — driven by annotations, not names

[src/utils/access-level.ts](./src/utils/access-level.ts) `makeAccessGatedRegister(server, accessLevel, audit)` decides at startup whether to register each tool, based on `config.annotations`:

- `readOnlyHint: true` → `read`
- `destructiveHint: true` → `destructive`
- explicit `readOnlyHint: false` AND `destructiveHint: false` → `write` (non-destructive mutation)
- anything else (unannotated / partially annotated) → `destructive` (fail-safe)

A tool registers when its derived level is at or below `MCP_GIT_AUDIT_ACCESS_LEVEL` (default: `read`). The audit-tool group is all `READ_ONLY`; the remotes, sync, and commit groups span `read` → `destructive` via the annotation presets in [src/utils/annotations.ts](./src/utils/annotations.ts) (`READ_ONLY`, `WRITE`, `WRITE_IDEMPOTENT`, `WRITE_IDEMPOTENT_REMOTE`, `DESTRUCTIVE`, `DESTRUCTIVE_REMOTE`, `DESTRUCTIVE_ONESHOT`). `DESTRUCTIVE_ONESHOT` is the right preset for tools whose effect depends on current FS / index state (running twice doesn't reach the same end state — `git_repo_commit` is the current example). The default `read` gate hides every mutation tool until the operator explicitly opts in via `MCP_GIT_AUDIT_ACCESS_LEVEL=write` or `=destructive`. New tools MUST set `annotations` explicitly to one of those presets — do not bypass the proxy.

### Three-stage pipeline

`git_repos_scan` returns a `ScanResult` envelope that `git_repos_audit` consumes. The audit tool re-validates **every** `abs_path` in that envelope against `cfg.safeRoots` before any `git` call — a cached scan cannot be used to widen the security boundary. `git_repo_detail` takes a single `abs_path` from a prior scan/audit and runs the same re-validation. Any new tool that accepts a previous result as input must enforce the same revalidation discipline.

## Security Requirements

This server walks user-supplied filesystem trees and shells out to `git`. New tools and changes to existing tools MUST preserve every invariant below.

1. **Every filesystem path runs through `resolveAgainstSafeRoots()`** from [src/utils/paths.ts](./src/utils/paths.ts) before any `fs.*` or `execFile` call. Two-layer check: lexical normalization plus `fs.realpath` of the deepest existing ancestor compared against the realpath of every safe root. Catches `..` traversal AND symlink escapes. New tools that take a path argument must validate against the **full** `cfg.safeRoots` set (threaded in as the first arg of the `main/` function), not a single root.
2. **Cached `scan` results are not trusted.** See [Three-stage pipeline](#three-stage-pipeline) above.
3. **`git` invocation uses `execFile` with argv array, never shell strings.** `runGit()` (audit), `runGitDetail()` (detail), and `runGitCapture()` (remotes/sync) all call `execFile('git', ['--no-optional-locks', '-C', repo, ...args], opts)`. The `--no-optional-locks` flag is mandatory.
4. **`git` calls are time- and memory-bounded.** Local-only commands use `GIT_LOCAL_TIMEOUT_MS` (8s) — except the `git_repo_detail` metadata read, which uses a deliberately shorter `DETAIL_TIMEOUT_MS` (6s); network commands (`fetch`, `pull`, `push`) use `GIT_NETWORK_TIMEOUT_MS` (60s). All capped by `maxBuffer`. Network-bound calls additionally set `GIT_TERMINAL_PROMPT=0` so an auth-required remote fails fast instead of hanging on a non-existent TTY. Optional metadata reads go through `tryRunGit()` which swallows errors. Never spawn an unbounded `git` call.
5. **Directory walks are depth-limited.** `findRepos()` in [src/main/repo-audit/scan.ts](./src/main/repo-audit/scan.ts) enforces `maxDepth` and prunes hidden dirs + `node_modules`. New walkers must enforce a depth cap.
6. **Identifier inputs that become argv tokens have tightened regex schemas.** Remote names, branch names, and remote URLs all use the validators in [src/utils/git-exec.ts](./src/utils/git-exec.ts): `remoteNameSchema`, `branchNameSchema`, `remoteUrlSchema`. Each rejects strings beginning with `-` (option-injection guard) and `..` sequences. New tools that accept user-supplied identifiers must reuse these schemas — bare `z.string().min(1)` is not acceptable.
7. **Destructive tools require `dry_run` default `true`.** Every tool registered at the `destructive` level (`git_repo_pull`, `git_repo_push`, `git_repo_remote_remove`) and every non-idempotent mutating tool exposes `dry_run: boolean`, defaults to preview, and only mutates when explicitly disabled. Where git has a native `--dry-run` we pass it through; for `pull` we approximate by running `git fetch --dry-run` against the same remote/branch.
8. **Force-push is gated behind an enum, not a boolean.** `git_repo_push` exposes `force_mode: 'none' | 'with_lease' | 'force'`. A boolean would be too easy to flip accidentally; the enum forces the caller to name what they want.
9. **Zod schemas are `.strict()` with bounded numerics.** Already true; new schemas must continue this.
10. **Per-repo failures don't crash the audit.** `git_repos_audit` aggregates errors into `errors[]`. This is a contract with downstream consumers — preserve it.

Traversal-rejection and command-injection-via-argv tests live in [src/utils/paths.test.ts](./src/utils/paths.test.ts), [src/utils/git-exec.test.ts](./src/utils/git-exec.test.ts), and the per-area `main/` tests (e.g. [src/main/repo-audit/detail.test.ts](./src/main/repo-audit/detail.test.ts), [src/main/repo-commit/commit.test.ts](./src/main/repo-commit/commit.test.ts)).

## Tool registration call sites

Tools are registered in [src/tools/repo-audit/index.ts](./src/tools/repo-audit/index.ts), [src/tools/repo-commit/index.ts](./src/tools/repo-commit/index.ts), [src/tools/repo-remotes/index.ts](./src/tools/repo-remotes/index.ts), and [src/tools/repo-sync/index.ts](./src/tools/repo-sync/index.ts). To survey the surface, `grep "registerTool" src/tools/*/index.ts`. README's [Available Tools](./README.md#available-tools) tabulates them with purposes and I/O shapes.
