---
id: MCP-GIT-TOOL-002
area: TOOL
title: Include stash, submodule state
theme: tool-surface
horizon: next
status: done
blocks: []
blocked_by: []
baseline_ref: 8a11bdbe5a123d3fe5ec3df94c935f5ca3e58476
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-04T20:00:00Z
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

- [x] Add `src/main/repo-audit/summaries.ts`: `stashSummary(repoDir)` counting `git stash list --format=%gd` lines; `submoduleSummary(safeRoots, repoDir)` parsing NUL-delimited `git ls-files --stage -z` for mode `160000` entries (stage 0 preferred; conflicted gitlinks are `unavailable`), sorting bytewise by path, keeping at most 100 and counting the rest as omitted.
- [x] Inspect each kept child: missing directory or `.git` entry is `uninitialised`; otherwise authorise with `resolveGitMetadata` (failure is `unavailable`), read `rev-parse --verify HEAD` (failure is `unavailable`), compare with the gitlink for `matched`/`changed`, and read `status --porcelain --ignore-submodules=all` for `dirty` (failure leaves `dirty` null).
- [x] Extend `RepoStatus` and `auditRepo(repo, safeRoots?)`; `auditScanWithinRoots` passes its safe roots; without safe roots (legacy `auditScan`/`auditRepo`) the submodule summary is `unavailable` with an explanatory error. Run the parent status with `--ignore-submodules=all` so no child Git runs before authorisation; submodule changes are reported through `submodules` instead.
- [x] Update the `git_repos_audit` output schema and description.
- [x] Cover zero and multiple stashes, clean, dirty, changed and uninitialised submodules, unusual literal paths, escaping child metadata, truncation, conflicted gitlinks and command failures with isolated fixtures; prove no Git process targets an unauthorised child.
- [x] Update the user auditing guide, developer architecture guide and changelog.

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

## Review

### Delivered

Per-repository `stash` and first-level `submodules` summaries on `RepoStatus` and the `git_repos_audit` output, under the decided contract: no stash subjects, at most 100 path-ordered submodule entries with an honest `omitted` count, child inspection only after `resolveGitMetadata` authorisation, no fetch, initialisation or recursion, and unavailable never reported as zero. The `errors` schema prerequisite was already satisfied by MCP-GIT-TOOL-001. Baseline `8a11bdbe5a123d3fe5ec3df94c935f5ca3e58476`; evidence is the implementation commit that follows it.

### Change Summary

- `src/main/repo-audit/summaries.ts` (new): `stashSummary(repoDir)` counts `git stash list --format=%gd` lines; `submoduleSummary(safeRoots, repoDir)` parses NUL-delimited `git ls-files --stage -z` for mode `160000`, keeps the first record per path (a non-zero stage marks it conflicted, hence `unavailable`), caps entries at `MAX_SUBMODULE_ENTRIES` (100) and inspects children sequentially. `submodulesWithoutAuthority()` covers the trusted library path.
- `audit.ts`: `RepoStatus` gains `stash` and `submodules`; `auditRepo(repo, safeRoots?)`; `auditScanWithinRoots` passes its safe roots. Material decision: the parent status now runs with `--ignore-submodules=all`, because default status recurses into initialised children before their metadata is authorised. Submodule changes therefore move from `modified` to `submodules`; this is recorded in the changelog and both guides.
- `src/tools/repo-audit/index.ts`: stash, submodule entry and summary output schemas (entries `.max(100)`) and an updated tool description.
- Tests: `summaries.test.ts` (zero and multiple stashes without subjects, matched, changed, dirty, unreadable-status, unborn, escaping, uninitialised, tab and newline literal paths, nested gitlinks not listed, truncation at 105, conflicted gitlink, failures); `authority.test.ts` proves no Git process targets an escaping child and no fetch, clone, submodule, pull, push or recursive argv is issued; `registration.test.ts` (new) parses the live handler response against the registered output schema.
- Docs: user auditing guide (new "Stashes and submodules" section), developer architecture guide ("Submodules" paragraph), `AGENTS.md` module list, `CHANGELOG.md`.

### Verification

- `bunx vitest run src/main/repo-audit src/tools`: 65 tests passed; `summaries.test.ts` 8 passed.
- `bun run test`: 200 tests passed.
- `bun run test:coverage`: 100% statements (811/811), branches (312/312), functions and lines; thresholds held.
- `bunx tsc --noEmit` clean; `bun run build` clean; local `biome check .` clean (pre-existing schema-version info only); `bunx knip` exit 0 with configuration hints identical to baseline; `rumdl check` clean on the changed Markdown.
- `bun run ki:test:smoke`: passed (12 tools, valid result envelope).
- `ki repo audit` passes in the primary checkout; in the isolated worktree the only failures are the known registry artefacts of the unregistered `/tmp` path (REPO-REG-1, ROUTE-1, RUNTIMES-2).

### Outstanding concerns

- Deviation from the shaped step: entries are not re-sorted in JavaScript. `git ls-files` emits the index in bytewise path order, which is the documented order, so an explicit sort was redundant and its comparator untestable under the 100% branch threshold.
- Callers that relied on initialised submodule changes appearing in `modified` will see them only in `submodules` (recorded as a changelog entry).
- The library `auditScan`/`auditRepo` path without safe roots reports submodules as `unavailable`; tools always use the authorised path.
- `src/generated/` was not regenerated: `ki:generate:client` needs the registered live server.

### Post-change review

The goal is met: retained stashes and first-level submodule drift are visible per repository, bounded and honest about unknowns, without weakening the MCP-GIT-TOOL-001 authority model. Scope held to the stated boundary; `git_repo_detail` and the commit, remotes and sync tools are unchanged. Regression risk is low apart from the deliberate `modified` change. Ready for acceptance review.

### Mini recap

Delivered stash and submodule summaries with full coverage and schema-validated output; all gates pass. The notable decision is ignoring submodules in parent status to avoid unauthorised child Git. Proposed learning route: none beyond the architecture-guide paragraph already added.

## Done

Accepted 2026-10-04 on the review packet above after an independent Fable review returned ACCEPT (stash and first-level submodule state reported with the decided fields, read-only and bounded, submodule containment proved; holds at HEAD). Decided by the Fable reviewer under delegated autonomy (2026-10-04), reversible.

## Discussion

### Readiness review

The earlier review kept this item in Soon/draft until the payload fields and submodule inspection policy were bounded. Both are now decided (see Shaping) and the item is Ready for exactly the stated boundary.
