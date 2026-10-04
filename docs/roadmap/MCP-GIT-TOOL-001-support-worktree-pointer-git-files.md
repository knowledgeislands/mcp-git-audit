---
id: MCP-GIT-TOOL-001
area: TOOL
title: Support worktree pointers
theme: tool-surface
horizon: next
status: done
blocks: []
blocked_by: []
baseline_ref: 1c5b3f4cf8360166add0f7b47fc528d8885c0723
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-04T20:00:00Z
---

## Goal

Repository discovery recognises linked Git worktrees while respecting the configured filesystem access boundary.

## Context

Support worktree-pointer `.git` files; the current implementation handles only `.git` directories.

## Boundary

Discovery of `.git` pointer files, a shared Git metadata authorisation helper, and its use before every Git invocation in the read-only audit paths (`git_repos_audit` and `git_repo_detail`). No new configuration, no metadata-authority setting, no change to the commit, remotes or sync tools, and no change to existing tool input schemas.

## Shaping

### Decision

Decided by the Fable reviewer under delegated autonomy (2026-10-04), reversible: every worktree `gitdir` and `commondir` target must lie within the already configured safe roots, checked symlink-aware after `realpath`. Pointers that escape those roots are reported as unsupported or unavailable. No new configuration or metadata-authority setting is introduced.

Reasoning: this is the strictly conservative reading of the existing authority contract - it neither broadens authority nor adds configuration, and it is reversible because a separate metadata-roots setting could be added later without breaking callers. Runtime-owned worktrees whose metadata lives outside the safe roots are therefore deliberately unsupported and are documented as such.

## Current state

`src/main/repo-audit/scan.ts` discovers only `.git` directories and explicitly skips worktree pointers. The existing path guard authorises a working directory, not every Git metadata path later followed by Git. A directory without any `.git` entry also lets `git -C` discover an ancestor repository, which may lie outside the safe roots. `auditScan`/`auditRepo` take no safe roots; the `git_repos_audit` tool revalidates each `abs_path` in the tool layer, and `repoDetail` revalidates its path in `main/`.

## Steps

- [x] Add `src/main/repo-audit/metadata.ts` with `resolveGitMetadata(safeRoots, repoDir)`: realpath and contain the working directory; `lstat` its `.git`; accept a real directory or a bounded regular pointer file (`gitdir: <path>`), resolving relative targets against the working directory; require the target to exist as a directory, reject symlink `.git` entries, malformed, oversized, dangling, cyclic (`ELOOP`, self-reference) and escaping pointers; read an optional `commondir` file and apply the same rules.
- [x] Teach `findRepos` to treat a regular `.git` file as a repository marker (no recursion into it), preserving depth and pruning rules; discovery stays Git-free and does not authorise metadata.
- [x] Add `auditScanWithinRoots(safeRoots, scan, opts)` in `audit.ts`: revalidate the root and every `abs_path` (whole-call failure on escape, as today), authorise each repository's metadata, report unauthorised repositories as per-repository `errors` without running Git, and audit the rest. Keep `auditScan`/`auditRepo` signatures for library compatibility.
- [x] Call the metadata check in `repoDetail` before any Git command; move the `git_repos_audit` tool's revalidation onto `auditScanWithinRoots`.
- [x] Test ordinary repositories, authorised worktrees (relative and absolute pointers, common directories), escaping `gitdir`/`commondir`, symlinked escapes, malformed, oversized, dangling and cyclic pointers, missing `.git`, depth limits, and prove with a mocked Git runner that no Git process is invoked for unauthorised metadata.
- [x] Document worktree support, metadata authority and unsupported worktrees in the user auditing and troubleshooting guides and the developer architecture guide.

## Files touched

`src/main/repo-audit/metadata.ts` and `metadata.test.ts` (new), `src/main/repo-audit/scan.ts` and test, `src/main/repo-audit/audit.ts` and tests, `src/main/repo-audit/detail.ts` and test, `src/tools/repo-audit/index.ts`, `docs/guides/user/auditing-repositories.md`, `docs/guides/user/troubleshooting.md`, `docs/guides/developer/architecture.md`, `CHANGELOG.md` if it tracks unreleased changes, and this record.

## Verify

Focused `bunx vitest run src/main/repo-audit`, then `bun run test`, `bun run test:coverage` (100% thresholds held), `bunx tsc --noEmit`, `bun run build`, `bunx @biomejs/biome check .`, `bun run ki:test:smoke` and `ki repo audit`. Fixtures must prove no Git process is invoked against unauthorised metadata.

## Dependencies / blocks

No build-order prerequisite. MCP-GIT-TOOL-002 reuses the metadata helper for submodule children and MCP-GIT-TOOL-003 reuses `auditScanWithinRoots`; both follow this item serially because they touch the same audit modules.

## Documentation impact

### Decision Records

None: the decision keeps the existing authority contract and adds no configuration, so it is recorded in this item rather than a standalone record. A separate metadata-roots setting would warrant one.

### Specifications

None; the repository keeps no specification tree for tool contracts.

### Guides

Update the user auditing and troubleshooting guides (worktree support, unsupported worktrees) and the developer architecture guide (metadata authorisation invariant).

### Roadmap

This record only.

## Review

### Delivered

Linked-worktree and other `.git` pointer-file discovery, plus Git metadata authorisation before every Git invocation in the read-only audit paths (`git_repos_audit`, `git_repo_detail`), within the decided policy: every `gitdir` and `commondir` target must lie inside the configured safe roots, with no new configuration. Excluded as planned: commit, remotes and sync tools; any metadata-roots setting. Baseline `1c5b3f4cf8360166add0f7b47fc528d8885c0723`; evidence is the implementation commit that follows it.

### Change Summary

- `src/main/repo-audit/metadata.ts` (new): `resolveGitMetadata(safeRoots, repoDir)` - requires an existing contained working directory with its own `.git` entry; accepts a `.git` directory or a bounded (4096-byte) single-line `gitdir:` pointer resolved against the working directory; realpaths and contains the `gitdir` and any `commondir` target; rejects symlinked, malformed, oversized, dangling, cyclic (`ELOOP`, self-reference, pointer-to-pointer) and escaping metadata as `unsupported Git metadata: ...`.
- `scan.ts`: a regular `.git` file now marks a repository (no recursion); symlinked `.git` entries are still not markers. Discovery stays Git-free and does not parse pointers.
- `audit.ts`: new `auditScanWithinRoots(safeRoots, scan, opts)` revalidates root and paths (whole-call failure on escape, as before), authorises metadata, and reports unauthorised repositories in `errors` without running Git. `auditScan`/`auditRepo` keep their signatures.
- `detail.ts`: `repoDetail` authorises metadata before Git and uses the authorised realpath; a missing path no longer silently falls back to an existing ancestor.
- `src/tools/repo-audit/index.ts`: `git_repos_audit` delegates to `auditScanWithinRoots`. Deviation (necessary, minimal): its `errors` output schema now declares `{ path, message }` objects - the previous string schema would have rejected the structured response whenever an unsupported worktree is reported. This is the prerequisite also named in MCP-GIT-TOOL-002, which is now already satisfied.
- Tests: `metadata.test.ts` (19 cases), `authority.test.ts` (wraps `execFile` to prove no Git process targets unauthorised metadata in audit or detail), `scan.test.ts` pointer discovery and depth cases.
- Docs: user auditing and troubleshooting guides, developer architecture guide, `AGENTS.md` repo-audit notes, `CHANGELOG.md`.

### Verification

- `bunx vitest run src/main/repo-audit`: 5 files, 54 tests passed.
- `bun run test`: 16 files, 189 tests passed.
- `bun run test:coverage`: 100% statements, branches, functions and lines (thresholds held).
- `bunx tsc --noEmit`: clean. `bunx @biomejs/biome check .`: clean (one pre-existing info). `bunx knip`: configuration hints only, identical to baseline.
- `bun run build`: clean. `bun run ki:test:smoke`: passed (12 tools, modern and legacy discovery).
- `ki repo audit` in the primary checkout passes; in the isolated worktree the only failures are registry artefacts of the unregistered `/tmp` worktree path (REPO-REG-1, ROUTE-1, RUNTIMES-2).

### Outstanding concerns

- `resolveAgainstSafeRoots` returns the realpath of the deepest existing ancestor for a missing path, so `git_repos_scan` given a missing `root` walks its nearest existing ancestor. Pre-existing, still contained by the safe roots, and outside this boundary; the audit and detail paths are now protected because `resolveGitMetadata` requires the full path to exist. Worth a separate item.
- The commit, remotes and sync tools still run Git against any contained `abs_path` without metadata authorisation (pre-existing, outside the decided "audit paths" boundary). A follow-up should adopt `resolveGitMetadata` there; MCP-GIT-TOOL-006 is concurrently touching commit code.
- Validation-then-execution is subject to the usual filesystem time-of-check/time-of-use window.
- `src/generated/` was not regenerated: `ki:generate:client` needs the registered live server; generated text only embeds descriptions.

### Post-change review

The goal is met: linked worktrees inside the safe roots are discovered and audited, and worktrees whose metadata escapes are reported as unsupported with no Git process run (proved by the `execFile` wrapper). Scope held to the audit paths plus the necessary `errors` schema correction. Regression risk is low: ordinary repositories behave as before; the stricter "must have its own `.git` entry" rule only changes `git_repo_detail` for non-root paths, which previously read an enclosing repository. Ready for acceptance review.

### Mini recap

Delivered pointer-file discovery and pre-Git metadata authorisation with full coverage; all gates pass. Concerns are the pre-existing ancestor fallback and non-audit tools lacking metadata checks. Proposed learning route: record the "metadata authority is never inferred from a working directory" invariant in the architecture guide (done) and capture the two follow-ups through `ki-next`.

## Done

Accepted 2026-10-04 on the review packet above after an independent Fable review returned ACCEPT (linked worktrees discovered and audited, escaping metadata reported unsupported with no Git process run, tests meaningful and holding at HEAD). Decided by the Fable reviewer under delegated autonomy (2026-10-04), reversible.

## Discussion

### Readiness review

The earlier review kept this item in Soon/draft pending an explicit policy for `.git` pointers outside the allowed roots. That policy is now decided (see Shaping) and the item is Ready for exactly the stated boundary.
