---
id: MCP-GIT-TOOL-003
area: TOOL
title: Audit multiple repositories
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

Callers can audit several explicitly authorised repository roots in one request, with clear results and failures for each root.

## Context

Add multi-root audit in a single call; multi-root is currently configuration-only and each request handles one root.

## Boundary

Keep the work limited to the stated surface.

## Shaping

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: choose additive batched envelope and root overlap/dedup semantics before readiness.

Promotion requires the named contract decisions and a fixture-based verification plan; no external account or network operation is needed.

## Discussion

### Readiness review

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: choose additive batched envelope and root overlap/dedup semantics before readiness.
