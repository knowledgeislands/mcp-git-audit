---
id: MCP-GIT-TOOL-003
area: TOOL
title: Audit multiple repositories
theme: tool-surface
horizon: now
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-04T21:40:00Z
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

## Selected contract

Decided by the Fable reviewer under delegated autonomy (2026-10-04), reversible. The earlier proposal is accepted with two amendments marked †.

- Tool: `git_repos_audit_roots`, read-only and additive; existing tools are unchanged.
- Strict input: `roots` 1-16 absolute or `~/` paths; `max_depth` 1-8, default 2, applying to every root; `limit` 1-1000, default 100, a whole-request cap on selected repositories.
- Validation before access: every root is expanded, authorised and canonicalised through `resolveAgainstSafeRoots` before any root is traversed. A relative or escaping root rejects the whole request, and no peer is touched. Whole-request rejection is reserved for shape and authorisation.
- † An absent or non-directory root inside a safe root is a per-root `error` (`scanned_at: null`, no repositories, one error naming the canonical root, `omitted: 0`), detected by an explicit `stat` at the start of that root's processing so that an empty directory stays `ok` with zero repositories.
- Duplicates and overlap: roots are keyed on their canonical path; an exact duplicate is removed, the first-requested position wins, and `duplicate_roots` reports `{ requested, canonical, duplicate_of_index }` against the results array. Overlapping distinct roots stay separate results and may repeat repositories, each selection counting against `limit`.
- Selection: roots are processed sequentially in result order; every root is scanned for truthful counts; within a root, repositories are taken in the existing scan order (group, then name) until the remaining whole-request budget is exhausted. `omitted` is scanned minus selected, and only selected repositories run `git`.
- Status: `error` for a root-level failure; `partial` when a scanned root has any per-repository or authorisation error or `omitted > 0`; otherwise `ok`, including an empty root.
- † Root identity: each result carries `requested` (as supplied) and `root` (canonical).
- Envelope: `{ requested_at, limit, max_depth, roots: [{ requested, root, status, scanned_at, audited_at, repos, errors, omitted }], duplicate_roots }`, with `errors` always an array and `audited_at` null where nothing was audited.
- These bounds constrain payload and selected Git work; they are not a command deadline or a bound on filesystem entries visited while scanning.

## Steps

- [x] Confirm additive tool naming, validation-before-access, overlap/dedup rules, result envelope and limits (Fable reviewer, delegated autonomy, reversible).
- [ ] Implement `auditRootsWithinSafeRoots` in `src/main/repo-audit/batch.ts`, reusing `scanRoot` and `auditScanWithinRoots`, with deterministic selection before audit.
- [ ] Register `git_repos_audit_roots` with strict input, the `READ_ONLY` preset and a matching structured output sharing the audit repository and error schemas.
- [ ] Verify aliases, duplicates, nested overlap, symlink escape, relative and absent roots, non-directory roots, empty roots, truncation across a root boundary, per-repository errors and result order with isolated fixtures.
- [ ] Update README, the user and developer guides, and regenerate clients through `bun run ki:generate:client` where the generator is available.

## Files touched

New `src/main/repo-audit/batch.ts` and tests, audit barrel and any necessary selection options, `src/tools/repo-audit/index.ts` and registration tests, generated client/type files, README and user/developer audit guides.

## Verify

Run focused batch/scan/audit/tool tests, then `bun run test`, `bun run test:coverage`, `bunx tsc --noEmit`, `bun run build`, Biome and Knip checks, and relevant MCP, engineering, guides and roadmap audits. Prove all roots validate before access, order and omitted counts are truthful, old APIs remain compatible, and no fetch or mutation occurs.

## Dependencies / blocks

No external or worktree-discovery prerequisite. Can land before or after stash/submodule summaries by importing the current canonical audit result. Coordinate shared audit/schema edits serially and regenerate clients after integration. Contract choices were decided as above; nothing else blocks readiness.

## Documentation impact

### Decision Records

None: an additive read-only tool whose reversible contract is recorded here.

### Specifications

The repository has no specification corpus; the tool description and README tool reference carry the contract.

### Guides

Publish the envelope, limits, duplicates, overlaps, partial and error states, and an example in README and `docs/guides/user/auditing-repositories.md`; document the orchestration in `docs/guides/developer/architecture.md`. Do not claim a global timeout guarantee.

### Roadmap

This record only.

## Discussion

### Readiness review

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: choose additive batched envelope and root overlap/dedup semantics before readiness.
