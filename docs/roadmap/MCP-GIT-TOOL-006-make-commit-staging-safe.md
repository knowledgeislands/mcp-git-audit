---
id: MCP-GIT-TOOL-006
title: Make commit staging safe
area: TOOL
theme: tool-surface
horizon: next
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-19T11:40:44Z
updated_at: 2026-10-04T10:57:44Z
---

## Goal

Make `git_repo_commit` safe for working trees shared by humans and agent threads without silently staging unrelated changes.

## Context

The tool currently defaults `stage` to `all_tracked`, implements that as `git add -u`, and also offers `all` through `git add -A`. Its default-true dry run still performs that staging mutation before calling `git commit --dry-run`. The portable `ki-git` policy now treats every working tree as potentially shared, tracks touched paths at file granularity, and forbids whole-tree staging because it can absorb another actor's work.

## Boundary

This intake record does not select a replacement API, change the tool, or adopt work. Any later design must preserve an explicit preview flow, path validation, access gating, and compatibility decisions for existing callers.

## Current state

`git_repo_commit` defaults to `all_tracked`, exposes an `all` mode, and lets dry-run staging mutate the real index. The repository therefore cannot promise that one caller commits only its own paths in a shared working tree.

## Steps

- [ ] Inventory the current commit schema, staged-index behaviour, generated client surface, and compatibility expectations.
- [ ] Design an explicit-path-first contract whose preview does not mutate the caller's real index and whose exceptional broad modes cannot be mistaken for the safe default.
- [ ] Implement path validation, index isolation or equivalent preview safety, and clear results for staged, skipped, and rejected paths.
- [ ] Add shared-tree, pre-staged-change, dry-run, path-error, and compatibility tests across the core and MCP tool boundaries.
- [ ] Update the public tool description and regenerate client projections only through their owning generation command.

## Files touched

Expected scope is `src/main/repo-commit/`, `src/tools/repo-commit/`, their tests, the MCP composition surface, and generated client projections when the reviewed public schema changes.

## Verify

Run the focused repo-commit suites, then `bun run test`, `bun run test:coverage`, `bunx tsc --noEmit`, `bun run build`, `bunx biome check .`, `bunx knip`, and the declared repository audits.

## Dependencies / blocks

No build-order blocker is known. Readiness requires an explicit compatibility decision for existing callers and a reviewed rule for callers that intentionally want to commit an already prepared index.

## Documentation impact

### Decision Records

Record a Decision Record only if compatibility requires retaining a broad staging capability or selecting a durable index-isolation architecture with consequences beyond this tool.

### Specifications

Update the accepted MCP tool contract to make explicit paths, index side effects, preview guarantees, and compatibility behaviour testable.

### Guides

Update operator and integration guidance for safe path selection and any migration from the existing staging modes.

### Roadmap

No additional roadmap record is expected unless client migration or generated-projection work proves independently deliverable.

## Concrete design proposal

Prefer explicit literal repository-relative file paths, reject pathspec magic and directory expansion, and remove broad staging from the safe default. Preview should use a temporary index and leave real-index bytes unchanged. Prepared-index commits need an explicit complete intended path set rather than silently committing every staged change. Serialise real Git writes, revalidate HEAD, selected content and index state before commit, and preserve unrelated staged entries on success and failure. A preview alone grants no later commit authority.

Compatibility is unresolved: the public schema, generated clients and operator guide currently expose all_tracked, all, paths and none, and explicitly describe preview staging as a real index mutation. Decide rejection versus an exceptional migration route for legacy broad modes, and how existing prepared-index callers migrate. Default changes alone do not discharge this decision.

## Hook and failure decisions

Define how hooks may modify the index and selected files. Post-hook verification must compare the exact resulting committed path set with the approved set. Detection after HEAD advances cannot truthfully promise that no unintended commit occurred; choose prevention/isolation or an explicitly reviewed recovery guarantee. Do not autonomously rewrite shared history to hide a hook-added path. Cover changed HEAD/index between preview and commit, concurrent edits, hook additions, temporary-index cleanup, failed hooks and unrelated pre-staged bytes. Fixture commits require repository-local Git identity, as AGENTS.md specifies.

## Source-confirmed evidence

At reviewed source commit `7bf24cb582162fc8f17c6704754f94010c0b2176`, `src/main/repo-commit/commit.ts` executes staging before the dry-run commit, and `src/tools/repo-commit/index.ts` defaults to all_tracked. The generated type declaration preserves the broad modes. `docs/guides/user/granting-write-access.md` documents the real-index preview effect and broad-default risk. This is a public compatibility change, not an internal cleanup.

## Discussion

### Shared-tree safety

A safe design should make explicit path selection the normal commit boundary and ensure preview does not leave an unrequested index mutation. It should decide whether broad staging modes are removed, isolated behind an exceptional opt-in, or represented by a different operation whose side effects are unmistakable.

### Compatibility

Changing the default or removing enum values affects the public MCP input schema and generated client. Planning should examine whether a staged-index-only mode remains useful and how callers migrate without preserving the unsafe default.

### Readiness review

Source confirms dry-run calls git add against the real index and default all_tracked absorbs unrelated work. Required next design: default explicit literal file paths; no broad modes; isolated preview index; a defined prepared-index mode that names the complete intended set; preservation of unrelated staged bytes; serialization and revalidation before commit; post-hook verification of exact committed paths. Reject pathspec magic/directory expansion and test hook additions, stale preview, concurrent changes, staged unrelated files and failure cleanup. An implementation plan remains unsafe until these choices and compatibility migration are concrete.
