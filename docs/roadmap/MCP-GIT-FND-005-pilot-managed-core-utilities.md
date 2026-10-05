---
id: MCP-GIT-FND-005
area: FND
title: Pilot managed core utilities
theme: foundation-tooling
horizon: now
status: done
blocks: []
blocked_by: []
baseline_ref: bf77656619854f650bb0102d1d2c784033243381
created_at: 2026-10-04T10:57:44Z
updated_at: 2026-10-05T07:51:06Z
---

# MCP-GIT-FND-005: Pilot managed core utilities

## Goal

Prove Git Audit's access gate, annotation vocabulary and result envelopes can use modern-v2-core without changing tool behavior or local audit privacy policy.

## Context

The Harness shared-code standard selects Git Audit as the modern pilot. The user on 2026-10-05 instructed completion of all MCP roadmap items and maximal delegation; that current outcome authority admits this one bounded receiver opt-in. Optional managed-file ownership and replacement are explicit in this plan, without fleet migration or publication.

## Boundary

Declare the existing modern-v2-core profile and replace only its three exact manifest assets. Keep audit logging, errors, config, Git helpers and redaction repository-owned. Preserve installed tool names, access tiers and result envelopes. No SDK/client migration, remote Git operation or package publication.

## Current state

Harness repaired projection ancestor validation in `be73f2fa`, accepted GOV-133 in `ac4e7c33`, then pruned it; the prerequisite is satisfied. The unmanaged local helpers already match the canonical behavior, with additional canonical textResult and remote annotation presets requiring coverage.

## Steps

- [x] Declare modern-v2-core and replace exactly its three files with manifest-verified bytes.
- [x] Extend result and annotation-tier fixtures, retaining local audit-wrapper behavior.
- [x] Document managed ownership, deliberate upgrades and rollback.
- [x] Verify full gates, exact digests, no-op CONFORM and isolated drift/unsafe-parent checks.
- [x] Record full review evidence for independent coordinator acceptance.

## Files touched

`.ki.toml`, `src/utils/access-level.ts`, `src/utils/annotations.ts`, `src/utils/results.ts`, focused utility tests, developer architecture guidance and this record. Audit/error/config seams remain local.

## Verify

Focused utility tests, full tests/coverage, TypeScript, build/smoke, Biome and Knip run sequentially. MCP/engineering/guides/roadmap audits validate the changed contract. Manifest digests must remain exact after formatting/hooks. Disposable receiver checks prove modified-file drift and ancestor refusal; repeated missing-only CONFORM must preserve exact file hashes.

## Dependencies / blocks

GOV-133's ancestor repair is satisfied by immutable Harness history. No remaining delivery dependency. Later migrations belong to their own receivers.

## Documentation impact

### Decision Records

None; existing profile ownership is accepted through this explicitly scoped outcome delivery.

### Specifications

The existing shared-code manifest is the exact projection contract; tool behavior does not change.

### Guides

Document managed files, local extensions, upgrades and rollback in the developer architecture guide.

### Roadmap

This record owns the one receiver pilot and its evidence; no estate migration is implied.

## Review

### Delivered

Git Audit deliberately adopts modern-v2-core version 1 as the one modern receiver pilot. All three managed files match the canonical manifest exactly; local audit/error/config and Git behavior remain independently owned.

### Change Summary

Declared profile ownership and replaced access-level, annotations and results with exact managed assets. Added text/structured-result and complete annotation-tier coverage. Developer architecture guidance explains extensions, reviewed upgrades and rollback. No tool name, gate tier, remote operation or client schema changed.

### Verification

239 tests in 21 files pass. Coverage has 860/860 lines, 394/394 branches and 142/142 functions. TypeScript, build, modern/legacy smoke, Biome and Knip pass. MCP (including engineering), guides and roadmap audits pass; CONFORM dry-run passes with no writes. A disposable receiver fixture proves modified managed-file refusal and ancestor-symlink refusal. Two repeated context CONFORM calls on the receiver propose zero writes, with all manifest digests exact and required seams present.

### Outstanding concerns

Independent review approved the exact delivery `c598bb58795925d74b496b3a134292db0346b5d5`; no remaining delivery blocker was found. This pilot is local source verification, not live-root or fleet-migration evidence. The extra presets do not change registration of existing tools.

### Post-change review

Compared managed behavior with the former receiver helpers and existing audit-wrapper/access fixtures. Tested the new result/preset capabilities and verified exact digests, physical parents and refusal paths. Required checks passed without bypasses.

### Mini recap

The receiver pilot is delivered; optional profile adoption in another MCP requires its own scope and evidence. Audit privacy policy remains local. No publication or live Git operation occurred.

## Done

Accepted under the named done-target MCP-GIT-BATCH-001 outcome authority and the principal’s standing instruction to accept reviewed deliveries. Independent reviewer `review_housekeeping` approved exact delivery `c598bb58795925d74b496b3a134292db0346b5d5`, verified manifest bytes and receiver ownership boundaries, and independently reran 40 focused tests. All planned work and required gates are evidenced above. No live operations or publication occurred.

## Discussion

### Authority and preservation

The current completion directive admits the pilot's declared profile ownership. The Harness owns exact assets; Git Audit owns adoption and local seams. Missing-only CONFORM cannot overwrite existing files, so this approved migration deliberately replaces them and retains rollback in Git history.
