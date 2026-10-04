---
id: MCP-GIT-TOOL-003
area: TOOL
title: Audit multiple repositories
theme: tool-surface
horizon: now
status: awaiting-review
blocks: []
blocked_by: []
baseline_ref: 60bb7c85f051ca1156f9bf53408bfd58ffd5acf3
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-04T22:20:00Z
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
- [x] Implement `auditRootsWithinSafeRoots` in `src/main/repo-audit/batch.ts`, reusing `scanRoot` and `auditScanWithinRoots`, with deterministic selection before audit.
- [x] Register `git_repos_audit_roots` with strict input, the `READ_ONLY` preset and a matching structured output sharing the audit repository and error schemas.
- [x] Verify aliases, duplicates, nested overlap, symlink escape, relative and absent roots, non-directory roots, empty roots, truncation across a root boundary, per-repository errors and result order with isolated fixtures.
- [x] Update README, the user and developer guides, and regenerate clients through `bun run ki:generate:client` where the generator is available.

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

## Review

### Delivered

`git_repos_audit_roots`, an additive read-only tool that scans and audits up to 16 explicitly requested roots in one call under the selected contract: every root authorised and canonicalised before any is walked, canonical duplicates reported in `duplicate_roots`, overlapping roots kept separate, one whole-request `limit` spent in root then scan order, only selected repositories running `git`, and `ok`/`partial`/`error` per root. Existing tools are unchanged. Baseline `60bb7c85f051ca1156f9bf53408bfd58ffd5acf3`; evidence is the implementation commit that follows it.

### Change Summary

- `src/main/repo-audit/batch.ts` (new): `auditRootsWithinSafeRoots(safeRoots, roots, { max_depth, limit })`, exported through the audit barrel. It composes `scanRoot` and `auditScanWithinRoots`, so repository authorisation and Git-metadata checks are exactly the single-root path's; an empty selection skips the audit and reports `audited_at: null`.
- Material implementation finding: `resolveAgainstSafeRoots` authorises a missing path through its deepest existing ancestor and returns that ancestor. Using its result directly would have walked the parent of an absent root. The batch layer therefore realpaths each authorised root; one that cannot be resolved is a per-root `error` reported under its `~/`-expanded spelling and is never accessed, including through a lexically normalised form that a `..` segment could steer outside the authorised ancestor. A root that resolves is `stat`ed at the start of its processing, as the contract requires, and a non-directory is a per-root `error`.
- `src/tools/repo-audit/index.ts`: strict input (`roots` 1-16 non-empty strings, `max_depth` 1-8 default 2, `limit` 1-1000 default 100), output schema reusing `auditedRepoSchema` and `auditErrorSchema`, `READ_ONLY` preset and a full description; failures use `errorResult`.
- Tests: `batch.test.ts` (new, isolated tmp fixtures with `$HOME` pointed at the fixture) covers request order, empty root, `~/` and symlink duplicates, an alias as first request, nested overlap against the shared limit, truncation across a root boundary and an exhausted budget with Git-target proof, absent and non-directory roots alongside a healthy peer, the `..` escape attempt, a per-repository authority error giving `partial`, and relative, escaping and symlink-escaping roots rejecting the request with no Git call; no `fetch` argv is issued. `registration.test.ts` parses the live handler response against the declared output schema and checks input bounds and strictness.
- Docs and surface: README tool table and overview, user auditing guide ("Auditing several roots at once", with an example envelope), developer architecture guide (batch orchestration and the missing-root finding), tool counts in the installing, troubleshooting, write-access and working-on-the-code guides, `AGENTS.md` naming list, `CHANGELOG.md`, `scripts/smoke.ts` expected tools, and `src/generated/` regenerated through `bun run ki:generate:client` against the local build.

### Verification

- `bunx vitest run src/main/repo-audit/batch.test.ts src/tools/repo-audit/registration.test.ts`: 17 passed.
- `bun run test:coverage`: 227 tests passed; 100% statements (993/993), branches (394/394), functions (141/141) and lines (862/862).
- `bunx tsc --noEmit` clean; `bun run build` clean; `bunx biome check .` clean (pre-existing schema-version info only); `bunx knip` exit 0 with the pre-existing configuration hints only.
- `bun run ki:test:smoke`: passed (13 tools, valid result envelope).
- `ki repo audit --repo .`: PASS=19 WARN=1 FAIL=0. The warning is TOOL-1, registration order not alphabetical; see Outstanding concerns.

### Outstanding concerns

- TOOL-1 warning: `repo-audit` registers in pipeline order (`git_repos_scan`, `git_repos_audit`, `git_repos_audit_roots`, `git_repo_detail`), which was already non-alphabetical before this item; the new tool is placed beside the audit tool it extends. Reordering would only reshuffle listing order and the generated client, so it is left as an intentional, stable order.
- Pre-existing, out of scope: `git_repos_scan` given an absent root inside a safe root scans that root's nearest existing ancestor, because it uses `resolveAgainstSafeRoots`'s return value directly. The batch tool does not share the behaviour. A follow-up item could align the single-root tool.
- A missing root's `root` is its expanded spelling rather than a canonical path, since none exists; such roots deduplicate only on identical spelling.
- The limit bounds payload and Git work, not elapsed time or filesystem entries visited, as the contract states.

### Post-change review

The goal is met: several authorised roots can be audited in one request with per-root results, truthful omitted counts and isolated failures, without weakening the safe-root or Git-metadata authority model. Scope held to the stated surface; existing tool contracts are unchanged. Regression risk is low; the new path reuses the audited single-root functions and is fully covered. Ready for acceptance review.

### Mini recap

Delivered `git_repos_audit_roots` with full coverage, schema-validated output and regenerated clients; all gates pass with one explained audit warning. The notable finding is that missing roots must not reuse the resolver's ancestor fallback. Proposed learning route: a possible follow-up item for `git_repos_scan`'s missing-root behaviour.

## Discussion

### Readiness review

This roadmap review adopts Soon shaping, with no Ready or implementation claim. Keep Soon/draft: choose additive batched envelope and root overlap/dedup semantics before readiness.
