# Architecture

How this server is arranged, which way its dependencies point, and which properties of that arrangement are load-bearing rather than incidental.

## Five directories, one direction

Everything under `src/` belongs to one of five layers, and dependencies only ever point downwards.

**`src/config/`** turns the environment into a plain `Config` value. `loadConfig(env?)` reads `MCP_GIT_AUDIT_*` and returns `{ safeRoots, accessLevel, auditLogMode, auditLogPath, auditLogMaxBytes, auditLogKeep }`. The important property is negative: there is no module-level config singleton and nothing reads the environment at import time. That is what lets tests pass a `Config` in directly instead of mutating `process.env` and resetting modules between cases.

**`src/mcp-server/`** is the stdio wrapper, and the only place where the whole thing is assembled. It calls `loadConfig()` once, builds the audit-log slice, replaces `server.registerTool` with the access-gated proxy, and threads the `Config` into each `registerXxxTools(server, config)`. It is excluded from coverage because it is wiring.

**`src/tools/`** holds MCP tool definitions and nothing else. A tool file validates arguments with a strict Zod schema, calls a `main/` function passing the config primitive it needs, and maps the result or the thrown error into an MCP envelope with `jsonResult` or `errorResult`. These files are excluded from coverage, which is precisely why logic must not live in them — anything with a branch in it belongs one layer down, where the gate can see it.

**`src/main/`** is the real implementation, grouped by concern in parallel with the tool groups: `repo-audit/` (`scan`, `audit`, `detail`), `repo-commit/` (`diff`, `commit`), `repo-remotes/`, and `repo-sync/`. Nothing here knows about MCP. Every entry point that touches the filesystem takes `safeRoots: readonly string[]` as its **first** argument, which makes the safety obligation impossible to forget at a call site and makes the whole layer usable from a plain script:

```ts
const cfg = loadConfig()
await diffRepo(cfg.safeRoots, '/abs/repo', { staged: false, max_lines: 500 })
```

**`src/utils/`** holds the reusable helpers shared with the sibling MCP servers in the estate — path resolution, the access gate, the audit log, the `git` execution wrappers and identifier schemas. These take the specific config primitive they need rather than the whole `Config`: `resolveAgainstSafeRoots(input, safeRoots)`, `makeAccessGatedRegister(server, accessLevel, audit)`, `withAuditLog(audit, name, level, cb)`. Keeping them narrow is what keeps them portable between servers.

`src/generated/` is machine-written by `bun run ki:generate:client` and is not hand-edited.

## The access gate is driven by annotations, not names

`makeAccessGatedRegister` wraps `server.registerTool` in a proxy that derives each tool's access level from its MCP annotations and registers it only when that level is at or below the configured one:

- `readOnlyHint: true` → `read`
- `destructiveHint: true` → `destructive`
- explicit `readOnlyHint: false` **and** `destructiveHint: false` → `write`
- anything else, including a partially annotated tool → `destructive`

That last line is the design decision worth understanding. An unannotated tool fails closed: it is treated as destructive and therefore hidden at the default level. Forgetting to annotate a new tool makes it invisible rather than dangerous.

Because the level comes from annotations, the honest thing to do with annotations is the safe thing. Use the presets in `src/utils/annotations.ts` — `READ_ONLY`, `WRITE`, `WRITE_IDEMPOTENT`, `WRITE_IDEMPOTENT_REMOTE`, `DESTRUCTIVE`, `DESTRUCTIVE_REMOTE`, `DESTRUCTIVE_ONESHOT` — rather than hand-writing hints. `DESTRUCTIVE_ONESHOT` is for a tool whose effect depends on current filesystem or index state, so that running it twice does not reach the same end state; `git_repo_commit` is the example.

Two things this gate is not. It is not an effect-level safeguard: `dry_run` is what stops a registered tool from changing anything, and the two are deliberately separate. And it is not a runtime check — registration happens once at startup, so a tool above the configured level does not exist in the session at all.

## Scan, audit, detail: a result is user input

`git_repos_scan` returns an envelope that `git_repos_audit` consumes, and `git_repo_detail` takes a single absolute path out of either. This is the pipeline that makes a walk reusable, and it carries one non-negotiable rule: **the audit tool re-validates every `abs_path` in the envelope against `safeRoots` before any `git` call.**

The reason is that an envelope which has left the server is no longer the server's own data. It has been through a model and a client, and it comes back as an argument. A cached scan can never widen the security boundary, because the boundary is re-checked on the way back in. Any future tool that accepts a previous result as input inherits this obligation.

## Safety invariants

These hold across the whole server, and a change that breaks one is a defect regardless of what it improves.

**Paths.** Every filesystem argument goes through `resolveAgainstSafeRoots` before any `fs` or `execFile` call, against the full configured set rather than a single root. The check is two-layer — lexical normalisation, then a realpath comparison of the deepest existing ancestor against the realpath of each safe root — so it catches `..` traversal and symlink escape alike.

**Subprocesses.** `git` runs through `execFile` with an argv array: `execFile('git', ['--no-optional-locks', '-C', repo, ...args], opts)`. Never a shell string, and `--no-optional-locks` is mandatory so that reading a repository cannot contend with a user's own `git`.

**Bounds.** Local `git` calls use an 8-second timeout, the `git_repo_detail` metadata read a deliberately shorter 6 seconds, and network commands 60 seconds; all are capped by `maxBuffer`. Network calls additionally set `GIT_TERMINAL_PROMPT=0`, so an auth-required remote fails fast rather than hanging on a TTY that does not exist. Optional metadata reads go through `tryRunGit`, which swallows errors by design. Nothing spawns an unbounded `git`.

**Walks.** `findRepos` enforces `maxDepth` and prunes hidden directories and `node_modules`. A new walker enforces a depth cap too.

**Identifiers.** Remote names, branch names, and remote URLs use `remoteNameSchema`, `branchNameSchema`, and `remoteUrlSchema`. Each rejects a leading `-`, which is the option-injection guard, along with `..` sequences and control characters.

**Previews.** Every destructive tool, and every non-idempotent mutating tool, exposes `dry_run` and defaults it to preview. Where `git` has a native `--dry-run` it is passed through; `git pull` has none, so its dry run is approximated by `git fetch --dry-run` against the same remote and branch, and that approximation is documented rather than hidden. `git_repo_fetch` is the deliberate exception that defaults to `false`, because a fetch updates only remote-tracking refs.

**Force.** `git_repo_push` exposes `force_mode: 'none' | 'with_lease' | 'force'`. A boolean would be one careless toggle away from a non-fast-forward push; an enum makes the caller name what they want.

**Schemas.** Zod schemas are `.strict()` with bounded numerics. An unknown key is an error, not something to ignore.

**Error isolation.** `git_repos_audit` aggregates per-repository failures into `errors[]` rather than failing the whole call. Downstream consumers depend on that, so it is a contract rather than a convenience.

The tests that pin these live alongside the code they guard — `src/utils/paths.test.ts` and `src/utils/git-exec.test.ts` for traversal and injection, and the per-area `main/` tests for the rest.

## Naming

Tool names are `<app>_<resource>_<action>` in snake_case with `<app>` fixed at `git`: plural resource for collection operations, singular for single-item ones. The current surface groups as `repo-audit` (`git_repos_scan`, `git_repos_audit`, `git_repo_detail`), `repo-commit` (`git_repo_diff`, `git_repo_commit`), `repo-remotes` (`git_repo_remotes_list`, `git_repo_remote_set_url`, `git_repo_remote_add`, `git_repo_remote_remove`), and `repo-sync` (`git_repo_fetch`, `git_repo_pull`, `git_repo_push`).

To survey what is registered, `grep registerTool src/tools/*/index.ts`.
