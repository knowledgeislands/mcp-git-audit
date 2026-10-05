---
id: MCP-GIT-FND-005
area: FND
title: Pilot managed core utilities
theme: foundation-tooling
horizon: now
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-04T10:57:44Z
updated_at: 2026-10-05T07:38:12Z
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

- [ ] Declare modern-v2-core and replace exactly its three files with manifest-verified bytes.
- [ ] Extend result and annotation-tier fixtures, retaining local audit-wrapper behavior.
- [ ] Document managed ownership, deliberate upgrades and rollback.
- [ ] Verify full gates, exact digests, no-op CONFORM and isolated drift/unsafe-parent checks.
- [ ] Record full review evidence for independent coordinator acceptance.

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

## Discussion

### Authority and preservation

The current completion directive admits the pilot's declared profile ownership. The Harness owns exact assets; Git Audit owns adoption and local seams. Missing-only CONFORM cannot overwrite existing files, so this approved migration deliberately replaces them and retains rollback in Git history.
