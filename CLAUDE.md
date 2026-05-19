# CLAUDE.md

Guidance for Claude Code when working in this repo. The user-facing tool surface, install/config, and Claude Desktop setup live in [README.md](./README.md); this file covers what Claude needs that isn't in README and isn't derivable from one grep.

## Bun vs Node

This project uses Bun (≥ 1.3) for install and dev scripts, but the compiled `dist/` runs under Node (≥ 22) — that's what Claude Desktop launches.

- `bun run test` (NOT `bun test` — the latter invokes Bun's own runner instead of vitest).
- Bun auto-loads `.env.${NODE_ENV}` from the CWD; Node needs the explicit `process.loadEnvFile()` call in [src/config.ts](./src/config.ts). The try/catch swallows the `TypeError` Bun raises (no `process.loadEnvFile`), so the same code works under both.
- `NODE_ENV` is set to `development` only by `server:mcp:dev` and `server:mcp:inspect`. Claude Desktop doesn't set it, so `.env.*` is ignored in production — `MCP_GIT_AUDIT_SAFE_ROOTS` must come from the Claude Desktop config `env` block.

Run `bun run` with no args for the full script list.

## Architecture Invariants

### Naming convention

Tool names follow `<app>_<resource>_<action>` (snake_case) with `<app>` = `git`. Plural resource for collection ops, singular for single-item ops. Current surface: `git_repos_scan`, `git_repos_audit`, `git_repo_detail`.

### Read-only by design — no role gate

Every tool is read-only (`READ_ONLY` annotation from [src/utils/annotations.ts](./src/utils/annotations.ts)); there is no `roles.ts` and no `MCP_GIT_AUDIT_ROLES`. Audit-log infra wraps `server.registerTool` directly via `makeAuditedRegister` ([src/utils/audit-log.ts](./src/utils/audit-log.ts)) — the role recorded in each event is derived from `annotations.readOnlyHint` so the JSONL shape matches the sibling MCPs. If a future tool ever needs to mutate, port the annotation-based role gate from one of the other repos rather than reintroducing prefix dispatch.

### Three-stage pipeline

`git_repos_scan` returns a `ScanResult` envelope that `git_repos_audit` consumes. The audit tool re-validates **every** `abs_path` in that envelope against `SAFE_ROOTS` before any `git` call — a cached scan cannot be used to widen the security boundary. `git_repo_detail` takes a single `abs_path` from a prior scan/audit and runs the same re-validation. Any new tool that accepts a previous result as input must enforce the same revalidation discipline.

## Security Requirements

This server walks user-supplied filesystem trees and shells out to `git`. New tools and changes to existing tools MUST preserve every invariant below.

1. **Every filesystem path runs through `resolveAgainstSafeRoots()`** from [src/utils.ts](./src/utils.ts) before any `fs.*` or `execFile` call. Two-layer check: lexical normalization plus `fs.realpath` of the deepest existing ancestor compared against the realpath of every safe root. Catches `..` traversal AND symlink escapes. New tools that take a path argument must validate against the **full** `SAFE_ROOTS` set, not a single root.
2. **Cached `scan` results are not trusted.** See [Three-stage pipeline](#three-stage-pipeline) above.
3. **`git` invocation uses `execFile` with argv array, never shell strings.** `runGit()` calls `execFile('git', ['--no-optional-locks', '-C', repo, ...args], opts)`. The `--no-optional-locks` flag is mandatory.
4. **`git` calls are time- and memory-bounded.** Every `runGit()` invocation specifies `timeout` (8s) and `maxBuffer`. Optional commands go through `tryRunGit()` which swallows errors. Never spawn an unbounded `git` call.
5. **Directory walks are depth-limited.** `findRepos()` in [src/scan.ts](./src/scan.ts) enforces `maxDepth` and prunes hidden dirs + `node_modules`. New walkers must enforce a depth cap.
6. **Zod schemas are `.strict()` with bounded numerics.** Already true; new schemas must continue this.
7. **Per-repo failures don't crash the audit.** `git_repos_audit` aggregates errors into `errors[]`. This is a contract with downstream consumers — preserve it.

Traversal-rejection and command-injection-via-argv tests live in [src/utils.test.ts](./src/utils.test.ts) and [src/audit.test.ts](./src/audit.test.ts).

## Tool registration call sites

Tools are registered in [src/tools/repo-audit/index.ts](./src/tools/repo-audit/index.ts). To survey the surface, `grep "registerTool" src/tools/*/index.ts`. README's [Available Tools](./README.md#available-tools) tabulates them with purposes and I/O shapes.
