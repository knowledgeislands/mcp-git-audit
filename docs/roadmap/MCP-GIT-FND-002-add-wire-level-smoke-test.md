---
id: MCP-GIT-FND-002
title: Add wire-level smoke test
theme: foundation-tooling
horizon: soon
status: open
blocks: []
blocked-by: []
baseline-ref: null
---

## Context

Add `bun run ki:test:smoke` to boot the built server and verify that the wire-level tool surface matches in-process registration, then run it in CI.

## Boundary

Keep the work limited to the stated surface.
