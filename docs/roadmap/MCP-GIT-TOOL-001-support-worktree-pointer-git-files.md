---
id: MCP-GIT-TOOL-001
area: TOOL
title: Support worktree pointers
theme: tool-surface
horizon: next
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-04T18:05:00Z
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

- [ ] Add `src/main/repo-audit/metadata.ts` with `resolveGitMetadata(safeRoots, repoDir)`: realpath and contain the working directory; `lstat` its `.git`; accept a real directory or a bounded regular pointer file (`gitdir: <path>`), resolving relative targets against the working directory; require the target to exist as a directory, reject symlink `.git` entries, malformed, oversized, dangling, cyclic (`ELOOP`, self-reference) and escaping pointers; read an optional `commondir` file and apply the same rules.
- [ ] Teach `findRepos` to treat a regular `.git` file as a repository marker (no recursion into it), preserving depth and pruning rules; discovery stays Git-free and does not authorise metadata.
- [ ] Add `auditScanWithinRoots(safeRoots, scan, opts)` in `audit.ts`: revalidate the root and every `abs_path` (whole-call failure on escape, as today), authorise each repository's metadata, report unauthorised repositories as per-repository `errors` without running Git, and audit the rest. Keep `auditScan`/`auditRepo` signatures for library compatibility.
- [ ] Call the metadata check in `repoDetail` before any Git command; move the `git_repos_audit` tool's revalidation onto `auditScanWithinRoots`.
- [ ] Test ordinary repositories, authorised worktrees (relative and absolute pointers, common directories), escaping `gitdir`/`commondir`, symlinked escapes, malformed, oversized, dangling and cyclic pointers, missing `.git`, depth limits, and prove with a mocked Git runner that no Git process is invoked for unauthorised metadata.
- [ ] Document worktree support, metadata authority and unsupported worktrees in the user auditing and troubleshooting guides and the developer architecture guide.

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

## Discussion

### Readiness review

The earlier review kept this item in Soon/draft pending an explicit policy for `.git` pointers outside the allowed roots. That policy is now decided (see Shaping) and the item is Ready for exactly the stated boundary.
