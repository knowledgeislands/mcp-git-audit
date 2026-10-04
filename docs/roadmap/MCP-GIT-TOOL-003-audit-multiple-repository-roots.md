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
updated_at: 2026-10-04T10:57:44Z
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

## Current state

`git_repos_scan` handles one root and `git_repos_audit` consumes one cached scan. Multiple safe roots affect configuration and root selection, not one-request batch execution. Existing audit helpers and their output schemas can support an additive orchestration layer.

## Proposed contract

Add a read-only `git_repos_audit_roots` tool without changing existing inputs. Proposed strict input: 1–16 explicit root paths, max depth 1–8 (default 2), and a whole-request selected-repository limit 1–1000 (default 100). Authorise and canonicalise every root before traversing any root. Invalid input rejects the whole request without accessing valid peers. Exact canonical duplicates are removed in first-requested order; overlapping distinct roots remain separate root-labelled results and may repeat repositories.

Process roots sequentially, select repositories deterministically before Git auditing, and expose omissions honestly. Proposed output contains request timestamp, ordered root results, and duplicate-root metadata. Each result carries root, ok/partial/error status, nullable scan timestamp, repository results, path/message errors and omitted-repository count. Empty valid roots succeed. Scan/root failures and individual repository failures preserve successful peers. These bounds constrain payload and selected Git work; they are not a whole-command deadline or a bound on all filesystem entries visited during scanning.

## Steps

- [ ] Confirm additive tool naming, validation-before-access, overlap/dedup rules, result envelope and limits.
- [ ] Implement config-injected batch orchestration using existing discovery semantics; define deterministic selection before audit.
- [ ] Register the tool with strict input, read-only annotations and matching structured output; share truthful path/message error schema.
- [ ] Verify aliases, duplicates, overlaps, symlink/escape rejection, empty roots, truncation, individual/root errors and result order.
- [ ] Update user/developer guidance and regenerate clients through `bun run ki:generate:client`.

## Files touched

New `src/main/repo-audit/batch.ts` and tests, audit barrel and any necessary selection options, `src/tools/repo-audit/index.ts` and registration tests, generated client/type files, README and user/developer audit guides.

## Verify

Run focused batch/scan/audit/tool tests, then `bun run test`, `bun run test:coverage`, `bunx tsc --noEmit`, `bun run build`, Biome and Knip checks, and relevant MCP, engineering, guides and roadmap audits. Prove all roots validate before access, order and omitted counts are truthful, old APIs remain compatible, and no fetch or mutation occurs.

## Dependencies / blocks

No external or worktree-discovery prerequisite. Can land before or after stash/submodule summaries by importing the current canonical audit result. Coordinate shared audit/schema edits serially and regenerate clients after integration. Contract choices remain awaiting approval, so Soon/Draft is preserved.

## Documentation impact

Publish the new envelope, limits, duplicates, overlaps, partial errors and examples in README and the auditing guide; document orchestration in developer architecture. Do not claim a global timeout guarantee.

## Discussion

### Readiness review

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: choose additive batched envelope and root overlap/dedup semantics before readiness.
