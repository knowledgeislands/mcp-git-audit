# AGENTS.md

Engineering follows `ki-engineering`, and the server's shape follows `ki-repo-mcp`: its layout, configuration injection, tool naming, annotation-driven access gate and security invariants, and where README and this file each hold what. The access level controls visibility and never substitutes for effect-level safeguards. Tests use isolated fixtures and never exercise real user roots.

Repository-specific implementation guidance follows. User-facing setup and tool documentation live in [README.md](./README.md) and [docs/guides/](./docs/guides/README.md).

This server targets MCP specification revision **2026-07-28**.

## Architecture Invariants

### Configuration and layers

- **[src/config/index.ts](./src/config/index.ts)** — `Config` carries `safeRoots` beside the standard fields, parsed from `MCP_GIT_AUDIT_SAFE_ROOTS` (colon-separated, default `~/workspaces`). A client that does not set `NODE_ENV` gets it from its `env` block or the package's `.env.local` or `.env`.
- **[src/tools/](./src/tools/)** — each tool passes `cfg.safeRoots` to its `main/` function.
- **[src/main/](./src/main/)** — grouped by concern, mirroring the tool groups: `main/repo-audit/` (`scan.ts`, `audit.ts`, `batch.ts`, `detail.ts`, `metadata.ts`, `summaries.ts` + an `index.ts` re-export), `main/repo-commit/` (`diff.ts`, `commit.ts` + `index.ts`), `main/repo-remotes/index.ts`, `main/repo-sync/index.ts`. Every `main` entry point that touches the filesystem takes `safeRoots: readonly string[]` as its **first argument** — `repoDetail(safeRoots, absPath, opts)`, `auditScanWithinRoots(safeRoots, scan, opts)`, `auditRootsWithinSafeRoots(safeRoots, roots, opts)`, `resolveGitMetadata(safeRoots, repoDir)`, `diffRepo(safeRoots, …)`, `commitRepo`, `listRemotes`/`setRemoteUrl`/`addRemote`/`removeRemote`, `fetchRepo`/`pullRepo`/`pushRepo`. `scanRoot`/`findRepos`/`auditScan`/`auditRepo` don't touch config and keep their existing signatures; `auditScan`/`auditRepo` trust their caller, so tools use `auditScanWithinRoots`.
- **[src/utils/](./src/utils/)** — path checks go through `resolveAgainstSafeRoots(input, safeRoots)`. `SERVER_NAME` in [audit-log.ts](./src/utils/audit-log.ts) stays `'mcp-git-audit'`.

To use the code from a script: `const cfg = loadConfig(); await diffRepo(cfg.safeRoots, '/abs/repo', { staged: false, max_lines: 500 })`.

This dependency direction is enforced, not just described: [.dependency-cruiser.ts](./.dependency-cruiser.ts) states each boundary as a named rule and [src/boundaries.test.ts](./src/boundaries.test.ts) cruises the source graph and proves every rule still rejects a deliberate crossing. Tool modules may import only `main/*/index.ts`, `config/index.ts` and the envelope, annotation, path and identifier helpers in `utils/` (`annotations`, `errors`, `git-exec`, `paths`, `results`); `src/generated/` is the emitted client for external consumers and nothing in `src/` imports it. The checker runs from its own install root, `tooling/depcruise`, because dependency-cruiser needs a TypeScript below 7.

### Tool surface

The `<app>` prefix is `git`. Current surface:

- **repo-audit** (read-only): `git_repos_scan`, `git_repos_audit`, `git_repos_audit_roots`, `git_repo_detail`.
- **repo-commit**: `git_repo_diff` (read), `git_repo_commit` (destructive — non-idempotent: writes a new commit each call).
- **repo-remotes**: `git_repo_remotes_list` (read), `git_repo_remote_set_url` (write/idempotent), `git_repo_remote_add` (write/additive), `git_repo_remote_remove` (destructive).
- **repo-sync**: `git_repo_fetch` (write — open-world idempotent), `git_repo_pull` (destructive — open-world), `git_repo_push` (destructive — open-world).

The gate is `MCP_GIT_AUDIT_ACCESS_LEVEL`, default `read`, which hides every mutation tool until the operator opts in. `git_repo_commit` is the `DESTRUCTIVE_ONESHOT` case: its effect depends on the current index, so running it twice does not reach the same end state.

### Three-stage pipeline

`git_repos_scan` returns a `ScanResult` envelope that `git_repos_audit` consumes. The audit tool re-validates **every** `abs_path` in that envelope against `cfg.safeRoots` before any `git` call — a cached scan cannot be used to widen the security boundary — and then authorises each repository's Git metadata (`.git` directory or pointer file, `gitdir` and `commondir` targets) with `resolveGitMetadata`, reporting escaping or malformed metadata in `errors[]` without running `git`. `git_repo_detail` takes a single `abs_path` from a prior scan/audit and runs the same re-validation. Any new tool that accepts a previous result as input must enforce the same revalidation discipline.

## Security Requirements

This server walks user-supplied filesystem trees and shells out to `git`. New tools and changes to existing tools MUST preserve every invariant below.

1. **Every filesystem path runs through `resolveAgainstSafeRoots()`** from [src/utils/paths.ts](./src/utils/paths.ts) before any `fs.*` or `execFile` call, against the **full** `cfg.safeRoots` set.
2. **Cached `scan` results are not trusted.** See [Three-stage pipeline](#three-stage-pipeline) above.
3. **`git` runs only through three helpers:** `runGitCapture()` in [src/utils/git-exec.ts](./src/utils/git-exec.ts) (every caller outside the detail read, the audit's `runGit()`/`tryRunGit()` among them), and `runGitDetail()`/`tryRunGitDetail()` in [src/main/repo-audit/detail.ts](./src/main/repo-audit/detail.ts). Each prefixes `--no-optional-locks -C <repo>`.
4. **`git` calls are time- and memory-bounded.** Local-only commands use `GIT_LOCAL_TIMEOUT_MS` (8s) — except the `git_repo_detail` reads, which use a deliberately shorter `DETAIL_TIMEOUT_MS` (6s); network commands (`fetch`, `pull`, `push`) use `GIT_NETWORK_TIMEOUT_MS` (60s). `runGitCapture()` sets `GIT_TERMINAL_PROMPT=0` on every call, after any caller override, so an auth-required remote fails fast. Optional metadata reads go through `tryRunGit()` or `tryRunGitDetail()`, which swallow errors.
5. **Directory walks are depth-limited.** `findRepos()` in [src/main/repo-audit/scan.ts](./src/main/repo-audit/scan.ts) enforces `maxDepth` and prunes hidden dirs and `node_modules`.
6. **Identifier inputs reuse the validators in [src/utils/git-exec.ts](./src/utils/git-exec.ts):** `remoteNameSchema`, `branchNameSchema`, `remoteUrlSchema`.
7. **Every mutating tool but `git_repo_fetch` defaults `dry_run` to `true`:** `git_repo_commit`, `git_repo_pull`, `git_repo_push`, `git_repo_remote_add`, `git_repo_remote_set_url` and `git_repo_remote_remove`. `git_repo_fetch`'s `dry_run` defaults to `false` and passes `--dry-run` through. `push` passes git's native `--dry-run`; `pull`, which has none, runs `git fetch --dry-run` against the same remote and branch; `commit` runs `git commit --dry-run` against a temporary index, leaving the real index, HEAD and the object store unchanged.
8. **Force-push is `git_repo_push`'s `force_mode: 'none' | 'with_lease' | 'force'`.**
9. **Per-repo failures don't crash the audit.** `git_repos_audit` aggregates errors into `errors[]`. This is a contract with downstream consumers — preserve it.

Traversal-rejection and command-injection-via-argv tests live in [src/utils/paths.test.ts](./src/utils/paths.test.ts), [src/utils/git-exec.test.ts](./src/utils/git-exec.test.ts), and the per-area `main/` tests (e.g. [src/main/repo-audit/detail.test.ts](./src/main/repo-audit/detail.test.ts), [src/main/repo-commit/commit.test.ts](./src/main/repo-commit/commit.test.ts)).

## Testing

Test fixtures that exercise code which itself writes a commit (a rebase or commit spawned by the code under test — `pullRepo`, `commitRepo`) must set repo-local git identity (`git config user.name` / `user.email`) on the fixture repo. The test helper's `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env vars only cover the helper's own git calls; production code spawns git without them, so in CI (no global git identity) an env-var-only fixture fails with `empty ident name`. `makeRepoWithUpstream` and `cloneWorkingCopy` in [src/main/repo-sync/index.test.ts](./src/main/repo-sync/index.test.ts) both set it — mirror that in any new git-commit fixture.

## Tool registration call sites

Tools are registered in [src/tools/repo-audit/index.ts](./src/tools/repo-audit/index.ts), [src/tools/repo-commit/index.ts](./src/tools/repo-commit/index.ts), [src/tools/repo-remotes/index.ts](./src/tools/repo-remotes/index.ts), and [src/tools/repo-sync/index.ts](./src/tools/repo-sync/index.ts). To survey the surface, `grep "registerTool" src/tools/*/index.ts`. README's [Available tools](./README.md#available-tools) tabulates them with purposes and I/O shapes.
