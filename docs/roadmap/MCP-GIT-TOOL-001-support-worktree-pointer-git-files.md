---
id: MCP-GIT-TOOL-001
area: TOOL
title: Support worktree pointers
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

Repository discovery recognises linked Git worktrees while respecting the configured filesystem access boundary.

## Context

Support worktree-pointer `.git` files; the current implementation handles only `.git` directories.

## Boundary

Keep the work limited to the stated surface.

## Shaping

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: worktree support needs explicit policy for .git pointers outside allowed roots before readiness.

Promotion requires the named contract decisions and a fixture-based verification plan; no external account or network operation is needed.

## Current state

`src/main/repo-audit/scan.ts` discovers only `.git` directories and explicitly skips worktree pointers. The existing path guard authorises a working directory, not every Git metadata path later followed by Git. Runtime-owned worktrees can live outside the estate discovery roots, so strict pointer containment may deliberately leave the intended use case unsupported.

## Proposed scope and decisions

A candidate implementation parses regular `.git` pointer files, resolves relative and absolute targets and common metadata, and preserves discovery depth and no-recursion behavior. Decide whether every worktree, gitdir and common metadata location must lie within existing safe roots, whether separately authorised metadata roots are needed, or whether extending operator configuration is the intended solution. Do not infer metadata authority from a permitted working directory. The source default of home-directory access does not prove compatibility with narrower deployed settings.

## Steps

- [ ] Inventory representative configured roots and runtime worktree locations using metadata only.
- [ ] Obtain the owner decision on working-directory versus metadata authority and document unsupported cases.
- [ ] Implement discovery and pre-command metadata validation together; reject malformed, dangling, cyclic and escaping pointers.
- [ ] Test ordinary repositories and authorised worktrees, relative/absolute pointers, common directories, symlink escapes, depth limits and missing metadata.

## Files touched

Expected scope: `src/main/repo-audit/scan.ts`, scan fixtures, metadata/path validation helpers and tests, audit/tool integration, and user/developer audit guidance. Configuration changes require a separately agreed authority contract.

## Verify

Run focused discovery/path/tool tests, then `bun run test`, `bun run test:coverage`, `bunx tsc --noEmit`, `bun run build`, and relevant MCP, engineering, guides and roadmap audits. Fixtures must prove no Git process is invoked against unauthorised metadata.

## Dependencies / blocks

No build-order prerequisite. The unresolved owner/configuration policy prevents Ready. Stash/submodule summaries and multi-root auditing can proceed independently using current discovery semantics.

## Documentation impact

Document pointer and common-metadata authority, unsupported worktrees and operator setup. Record a durable decision if separate metadata authority is selected. This remains Soon/Draft, not approved execution.

## Discussion

### Readiness review

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: worktree support needs explicit policy for .git pointers outside allowed roots before readiness.
