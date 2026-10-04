---
id: MCP-GIT-TOOL-002
area: TOOL
title: Include stash, submodule state
theme: tool-surface
horizon: soon
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-04T10:57:44Z
---

## Goal

Repository reports make retained stashes and submodule state visible so callers can assess work that the ordinary working-tree summary misses.

## Context

Extend each repository payload with stash and submodule state.

## Boundary

Keep the work limited to the stated surface.

## Shaping

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: bound payload fields and submodule inspection policy before readiness.

Promotion requires the named contract decisions and a fixture-based verification plan; no external account or network operation is needed.

## Current state

`RepoStatus` in `src/main/repo-audit/audit.ts` has no stash or submodule summary. Audit tool schemas live in `src/tools/repo-audit/index.ts`. Existing per-repository failures are aggregated, but its declared `errors` schema currently expects strings while the implementation emits path/message objects; matching schemas are a scoped prerequisite for truthful structured output.

## Proposed contract

Add a stash summary with available/unavailable status, nullable count and optional error; expose no subjects. Add a first-level submodule summary with available/unavailable status, nullable total, omitted count and at most 100 entries sorted by repository-relative path. Entries contain literal path, expected index gitlink commit, nullable actual commit, state (uninitialised, matched, changed or unavailable) and nullable dirty status. Unavailable values are never zero substitutes.

Inspect tracked first-level gitlinks only. Do not fetch, initialise, recurse through nested submodules or expose file contents. Before invoking Git inside a child, authorise its directory, `.git` target and common metadata against configured safe roots; escaping metadata is unavailable. Existing timeout/buffer limits apply. Exact field names and caller compatibility for passing safe-root primitives remain proposals requiring review before Ready.

## Steps

- [ ] Confirm the additive result fields, 100-entry limit, unavailable vocabulary and library compatibility.
- [ ] Add typed bounded summary helpers and NUL-delimited gitlink parsing.
- [ ] Validate child directory and metadata containment before inspection; propagate safe-root primitives without introducing a configuration singleton.
- [ ] Update matching shared result/error schemas and registered-tool verification.
- [ ] Cover zero/multiple stashes, clean/dirty/changed/uninitialised submodules, unusual literal paths, escaping metadata, truncation and command failures with isolated fixtures.
- [ ] Update guides and regenerate clients through `bun run ki:generate:client`.

## Files touched

`src/main/repo-audit/audit.ts`, new summary helper and tests, `audit.test.ts`, `src/tools/repo-audit/index.ts` and focused registration tests, containment helpers/tests if needed, generated client/type files, user auditing guide and developer architecture guide.

## Verify

Run focused audit/path/tool suites, `bun run test`, `bun run test:coverage`, `bunx tsc --noEmit`, `bun run build`, Biome and Knip checks, then focused MCP, engineering, guides and roadmap audits. Assert no network operation, recursive inspection or unauthorised child Git invocation. Verify the MCP structured response, not merely its core object.

## Dependencies / blocks

No external prerequisite and no dependency on worktree discovery. Unsupported metadata yields unavailable information. Any expansion beyond existing safe-root authority stops for owner review. Sequence edits with multi-root work because both touch audit schemas; this is write coordination, not build-order blocking.

## Documentation impact

Describe field semantics, truncation and unavailable cases in tool descriptions and the user auditing guide; explain first-level containment in developer architecture. Create no specification tree merely for this item. The concrete contract awaits approval; Soon/Draft is preserved.

## Discussion

### Readiness review

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: bound payload fields and submodule inspection policy before readiness.
