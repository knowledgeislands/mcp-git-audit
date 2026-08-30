---
id: MCP-GIT-TOOL-005
title: Pilot MCP SDK v2
area: TOOL
theme: tool-surface
horizon: next
status: done
blocks: []
blocked_by: []
baseline_ref: 6ca2245e13cfc87b8e475a7adb0e89bfe2eb0d5a
---

## Goal

Prove the exact migration delta from the current MCP TypeScript SDK v1 server to the 2026-07-28 SDK v2 protocol family before the Harness changes its portable MCP conformance profile.

## Context

`KI-HARNESS-GOV-006` selected `mcp-git-audit` as the representative local stdio pilot. The server currently uses `@modelcontextprotocol/sdk` `1.30.x`; the newer protocol requires result envelopes carrying `resultType`, a `server/discover` operation, and different SDK package and stdio-serving mechanics.

The user has authorised direct receiver-owned roadmap capture instead of an intermediate trade. This record supplies the bounded pilot evidence; the Harness retains ownership of the eventual fleet profile and rubric decision.

## Boundary

Do not migrate other MCP repositories, change the Harness standard, publish a package, tag a release, or push a branch in this item. Preserve existing tool names, access annotations, filesystem and Git safety boundaries, and local stdio operation. Do not add remote transport merely because the new protocol supports it.

## Current state

The repository is on SDK `1.30.x`, exposes a Node-hosted stdio MCP, and has focused contract tests plus 100% coverage expectations. No SDK-v2 pilot record or implementation exists after the unrelated issued `TOOL-004` record was pruned.

## Steps

- [x] Record the exact current and candidate SDK package versions and the 2026-07-28 protocol revision.
- [x] Migrate one isolated branch or local worktree to the SDK v2 package family and its supported stdio entry point.
- [x] Update every result helper and tool response to the required `resultType` envelope without weakening error or annotation semantics.
- [x] Implement `server/discover` with supported versions, capabilities, identity, and cache behaviour grounded in the specification.
- [x] Add CLI-level MCP fixtures for discovery, result envelopes, stdio start-up, malformed requests, and any documented legacy fallback.
- [x] Compare the resulting diff and runtime behaviour with v1, explicitly recording removed session, initialization, or transport assumptions.
- [x] Run the repository's full coverage, type, format, build, smoke, and focused governance gates.
- [x] Return the verified migration delta to `KI-HARNESS-GOV-006`; do not generalise the pilot into fleet policy locally.

## Files touched

- `package.json` and `bun.lock`
- `src/mcp-server/`, `src/tools/`, and shared result helpers
- Focused MCP contract tests and generated client surfaces where required
- Repository documentation only where the supported local interface changes
- `docs/roadmap/MCP-GIT-TOOL-005-pilot-mcp-sdk-v2.md`

## Verify

- `bun run test:coverage`
- `bunx tsc --noEmit`
- `bunx biome check`
- `bun run build`
- `bun run test:smoke`
- `ki repo audit --skill ki-repo-mcp --repo .`
- `ki repo audit --skill ki-engineering --repo .`
- Confirm the server starts over stdio and returns a valid discovery result and typed tool result without contacting a real user repository.

## Dependencies / blocks

No local dependency blocks the pilot. Harness fleet adoption and all sibling migrations remain downstream decisions and are not required for this record to reach review.

## Documentation impact

### Decision Records

No local Decision Record is required for a pilot. The Harness owns the rollout decision informed by its evidence.

### Specifications

No local product specification changes unless the public tool behaviour changes; protocol conformance evidence belongs with the tests.

### Guides

Update the README only for a supported invocation or compatibility change observable by operators.

### Roadmap

This item supplies evidence to `KI-HARNESS-GOV-006` and creates no sibling migration records.

## Review

### Delivered

Against immutable baseline `6ca2245e13cfc87b8e475a7adb0e89bfe2eb0d5a`, migrated the representative Node-hosted stdio server from `@modelcontextprotocol/sdk` `1.30.0` to released `@modelcontextprotocol/server` and `@modelcontextprotocol/client` `2.0.0` packages on the isolated `work/mcp-sdk-v2-pilot` branch.

### Summary of changes

The server now uses the supported `serveStdio` factory, advertises and negotiates protocol revision `2026-07-28` through SDK-owned `server/discover`, and deliberately retains the 2025-era initialize fallback with `legacy: 'serve'`. Shared success and error helpers return `resultType: 'complete'`. The smoke client uses the v2 package, proves modern discovery metadata, capabilities, identity, malformed-argument rejection, a valid complete wire result, the unchanged 12-tool surface, and a separate legacy connection. Vitest reports now live under `reports/coverage`.

### Verification

All 161 tests pass at 100% statements, branches, functions, and lines coverage. TypeScript, Biome, build, and stdio smoke pass. `ki-repo-mcp`, `ki-engineering`, roadmap, and authoring audits pass. The engineering audit was rerun sequentially after an initial concurrent double-coverage invocation raced the same temporary directory; the isolated rerun is clean.

### Outstanding concerns

Biome reports an informational schema URL at `2.5.7` while the CLI is `2.5.10`; it does not fail formatting and is unrelated to the protocol pilot. The pilot intentionally keeps legacy stdio service for fleet transition evidence. Choosing when the house standard requires modern-only behavior remains `KI-HARNESS-GOV-006` policy, not a local server decision.

### Post-change review

The migration is viable and stable without changing tool names, annotations, access gates, filesystem/Git safeguards, operator invocation, remote transport, or public tool behavior. The v2 SDK owns discovery, protocol stamping, server identity metadata, and era negotiation; local code owns only server construction and its result helper contract.

### Mini recap

The SDK-v2 delta is proven on one representative stdio server with modern and legacy paths, complete-result validation, full coverage, and clean governance gates. It is ready to inform the Harness rollout decision without generalising policy locally.

## Done

Accepted at `2026-08-30T00:01:07Z` through closure authority bound to `MCP-GIT-BATCH-002`. Delivery branch commit `c7a7342` was merged to `main` by `ffd9ec8235289d48c7c30648b2b05ce2e692e553`. The six-part review packet, 161-test 100%-coverage suite, TypeScript, Biome, build, modern and legacy stdio smoke, MCP audit, engineering audit, roadmap audit, and authoring audit were clean before closure. No push, release, publication, remote transport, real user-root Git action, or sibling write occurred.

## Discussion

The pilot is deliberately the smallest representative stdio server. A successful package migration is insufficient by itself: the evidence must show the new discovery and result contracts, preserve existing safety behaviour, and make the fleet compatibility choice explicit.
