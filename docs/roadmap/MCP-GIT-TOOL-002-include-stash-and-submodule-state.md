---
id: MCP-GIT-TOOL-002
area: TOOL
title: Include stash, submodule state
theme: tool-surface
horizon: next
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-04T18:12:30Z
---

## Goal

Repository reports make retained stashes and submodule state visible so callers can assess work that the ordinary working-tree summary misses.

## Context

Extend each repository payload with stash and submodule state.

## Boundary

Additive `stash` and `submodules` fields on each audited repository (`RepoStatus`, `git_repos_audit` output), first-level submodule inspection authorised against the existing safe roots, and the shared audit error schema. No fetch, initialisation or recursion, no file contents or stash subjects, no new configuration, and no change to `git_repo_detail` or the commit, remotes and sync tools.

## Shaping

### Decision

Decided by the Fable reviewer under delegated autonomy (2026-10-04), reversible: adopt the proposed contract as written. A stash summary carries available/unavailable status, a nullable count and an optional error, and exposes no subjects. A first-level submodule summary carries status, a nullable total, an omitted count and at most 100 entries sorted by repository-relative path; each entry has the literal path, the expected index gitlink commit, a nullable actual commit, a state (`uninitialised`, `matched`, `changed` or `unavailable`) and a nullable dirty flag. Child inspection is authorised against the existing safe roots by reusing the MCP-GIT-TOOL-001 metadata validation. There is no fetch, initialisation or recursion, and unavailable is never reported as zero. The `errors` schema mismatch is an in-scope prerequisite (already corrected by MCP-GIT-TOOL-001).

Reasoning: the contract is additive, bounded and consistent with the existing authority model, and it is reversible because the fields are new.

### Field names

Snake case, matching `RepoStatus` (`has_remote`, `remote_url`):

- `stash`: `{ status: 'available' | 'unavailable', count: number | null, error?: string }`.
- `submodules`: `{ status: 'available' | 'unavailable', total: number | null, omitted: number | null, entries: SubmoduleEntry[], error?: string }`. `omitted` is null alongside `total` when the summary is unavailable, so no zero stands in for an unknown.
- `SubmoduleEntry`: `{ path, expected_commit, actual_commit: string | null, state, dirty: boolean | null }`.

## Current state

`RepoStatus` in `src/main/repo-audit/audit.ts` has no stash or submodule summary. The `errors` schema already declares path/message objects (MCP-GIT-TOOL-001). The parent `git status --porcelain` in `auditRepo` recurses into initialised submodules by default, which runs Git against child metadata that has not been authorised. `auditScanWithinRoots(safeRoots, scan, opts)` and `resolveGitMetadata(safeRoots, repoDir)` exist.

## Steps

- [ ] Add `src/main/repo-audit/summaries.ts`: `stashSummary(repoDir)` counting `git stash list --format=%gd` lines; `submoduleSummary(safeRoots, repoDir)` parsing NUL-delimited `git ls-files --stage -z` for mode `160000` entries (stage 0 preferred; conflicted gitlinks are `unavailable`), sorting bytewise by path, keeping at most 100 and counting the rest as omitted.
- [ ] Inspect each kept child: missing directory or `.git` entry is `uninitialised`; otherwise authorise with `resolveGitMetadata` (failure is `unavailable`), read `rev-parse --verify HEAD` (failure is `unavailable`), compare with the gitlink for `matched`/`changed`, and read `status --porcelain --ignore-submodules=all` for `dirty` (failure leaves `dirty` null).
- [ ] Extend `RepoStatus` and `auditRepo(repo, safeRoots?)`; `auditScanWithinRoots` passes its safe roots; without safe roots (legacy `auditScan`/`auditRepo`) the submodule summary is `unavailable` with an explanatory error. Run the parent status with `--ignore-submodules=all` so no child Git runs before authorisation; submodule changes are reported through `submodules` instead.
- [ ] Update the `git_repos_audit` output schema and description.
- [ ] Cover zero and multiple stashes, clean, dirty, changed and uninitialised submodules, unusual literal paths, escaping child metadata, truncation, conflicted gitlinks and command failures with isolated fixtures; prove no Git process targets an unauthorised child.
- [ ] Update the user auditing guide, developer architecture guide and changelog.

## Files touched

`src/main/repo-audit/summaries.ts` and `summaries.test.ts` (new), `src/main/repo-audit/audit.ts`, `audit.test.ts`, `authority.test.ts`, `src/tools/repo-audit/index.ts`, `docs/guides/user/auditing-repositories.md`, `docs/guides/developer/architecture.md`, `CHANGELOG.md`, and this record. Generated clients are regenerated only if a registered live server is available; otherwise noted.

## Verify

Focused `bunx vitest run src/main/repo-audit`, then `bun run test`, `bun run test:coverage` (100% thresholds held), `bunx tsc --noEmit`, `bun run build`, `bunx @biomejs/biome check .`, `bunx knip`, `bun run ki:test:smoke` and `ki repo audit`. Assert no network operation, recursive inspection or unauthorised child Git invocation, and validate the structured response against the registered output schema.

## Dependencies / blocks

Builds on MCP-GIT-TOOL-001 (metadata validation, `auditScanWithinRoots`, errors schema), which has landed. MCP-GIT-TOOL-003 follows serially because it reuses the audited repository schema.

## Documentation impact

### Decision Records

None: the contract is additive within the existing authority model and is recorded here.

### Specifications

None; the repository keeps no specification tree for tool contracts.

### Guides

Describe field semantics, truncation and unavailable cases in the user auditing guide and tool description; explain first-level containment and the parent status change in the developer architecture guide.

### Roadmap

This record only.

## Discussion

### Readiness review

The earlier review kept this item in Soon/draft until the payload fields and submodule inspection policy were bounded. Both are now decided (see Shaping) and the item is Ready for exactly the stated boundary.
