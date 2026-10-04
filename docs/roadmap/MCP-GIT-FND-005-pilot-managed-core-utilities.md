---
id: MCP-GIT-FND-005
area: FND
title: Pilot managed core utilities
theme: foundation-tooling
horizon: triage
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-04T10:57:44Z
updated_at: 2026-10-04T10:57:44Z
---

# MCP-GIT-FND-005: Pilot managed core utilities

## Goal

Prove that Git Audit's shared access gate, annotation vocabulary and result envelopes can use the managed modern-v2-core profile without changing tool behavior or local audit privacy policy.

## Context

The [Harness shared-code standard](../../../ki-agentic-harness/skills/repo-structure/ki-repo-mcp/references/standards-mcp-shared-code.md) selects Git Audit as the modern pilot because it already has utility fixtures and a narrow result surface. No existing receiver roadmap or trade record owns profile adoption. Current local results, annotations and access gate remain unmanaged; adoption is optional and requires a deliberate receiver declaration.

## Boundary

One receiver pilot only. Do not publish a package, create an estate-wide migration, manage audit-log.ts, replace Git URL redaction, adopt a shared audit engine or rewrite locally owned seams. Preserve the installed tool names, access-tier behavior, SDK result semantics and configuration injection. Triage capture is not profile opt-in or implementation authority.

## Proposed shaping

Compare exact manifest assets, imports, exports and local extension seams with the current utilities. Preserve required local config/errors/audit seams as separate regular files, and prove the canonical profile's complete annotation vocabulary does not widen registered access. Agree explicit profile opt-in and migration/rollback before replacing utilities; CONFORM's missing-only behavior is not overwrite authority for current files. Run focused fixtures and full receiver gates, verify projection digest markers, drift detection, unsafe-path refusal and repeated-CONFORM idempotence, then document the observed pilot outcome for later receivers.

## Dependencies / blocks

Before any receiver projection, [KI-HARNESS-GOV-133](../../../ki-agentic-harness/docs/roadmap/KI-HARNESS-GOV-133-reject-mcp-projection-ancestor-symlinks.md) must repair and verify ancestor-symlink rejection in the owner Harness. Its observed defect can certify files reached through a symlinked ancestor or propose writes outside the receiver boundary. This is a cross-repository prerequisite in prose, not a receiver blocked_by identifier or a claim that lifecycle acceptance is required once the repair exists.

## Verification proposal

Use fixture-only utility and tool-registration tests, typecheck, full tests/coverage, build and smoke checks, then focused MCP/shared-code, engineering, guides and roadmap audits. Compare before/after access tiers, annotations and result envelopes; retain Git URL sanitization and audit error privacy checks. No live roots, remote Git operations or publishing.

## Discussion

### Receiver authority

Keep this unadopted Triage/Draft until the receiver chooses the bounded pilot and its execution plan. The Harness owns assets and projection safety; Git Audit owns migration, local behavior and acceptance.

### Sequencing

Resolve Harness projection safety before managed writes. Tool-surface plans remain independent, but coordinate shared result/schema edits and generated client validation to avoid concealing contract drift inside the pilot.
