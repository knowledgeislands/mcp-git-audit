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
updated_at: 2026-10-01T19:30:08Z
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

## Discussion

### Readiness review

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: worktree support needs explicit policy for .git pointers outside allowed roots before readiness.
