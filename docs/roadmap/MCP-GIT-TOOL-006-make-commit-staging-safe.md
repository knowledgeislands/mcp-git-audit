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
updated_at: 2026-09-20T07:47:23Z
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

## Discussion

### Shared-tree safety

A safe design should make explicit path selection the normal commit boundary and ensure preview does not leave an unrequested index mutation. It should decide whether broad staging modes are removed, isolated behind an exceptional opt-in, or represented by a different operation whose side effects are unmistakable.

### Compatibility

Changing the default or removing enum values affects the public MCP input schema and generated client. Planning should examine whether a staged-index-only mode remains useful and how callers migrate without preserving the unsafe default.
