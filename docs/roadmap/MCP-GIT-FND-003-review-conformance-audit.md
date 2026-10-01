---
id: MCP-GIT-FND-003
title: Review conformance audit
area: FND
theme: foundation-tooling
horizon: next
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-04T08:53:59Z
updated_at: 2026-10-01T19:27:46Z
---

## Goal

Give the owner an evidence-backed recommendation for each retained conformance concern, distinguishing remaining work from repairs already delivered and explicitly recording missing historical evidence.

## Context

The estate audit reported Decision Records adoption, managed `.gitignore`, and GitHub metadata findings.

## Boundary

Investigate the named historical conformance concerns and prepare an evidence-backed recommendation. No code fixes, remote setting changes, acceptance, disposition or pruning.

## Current state

The retained item reports historical Decision Records adoption, managed ignore rules and GitHub metadata. Its September pickup checkpoint records later mechanical audit passes, but contains no original finding IDs or acceptance criteria. Passing current audits cannot reconstruct missing historical judgment evidence.

## Steps

- [ ] Inventory each historical concern separately; search repository history, retained decisions and local audit evidence for the original rule, finding ID, observed fact and acceptance criterion. Mark unrecoverable evidence explicitly rather than inventing it.
- [ ] Run fresh focused `ki-repo`, `ki-decision-records`, `ki-git` and `ki-work-roadmap` audits and inspect the source supporting each relevant finding. Read GitHub metadata only if a concern requires it and authenticated read access is available; record unavailable remote evidence as unknown.
- [ ] Write a concern-by-concern assessment in this record with source locations, current observation, remaining gap and proposed repair/defer/exception decision. Distinguish mechanical passes, judgment findings and historical unknowns.
- [ ] Present the assessment for owner review. Capture any substantive remediation through the normal roadmap intake process; do not implement fixes or self-dispose historical concerns under this investigation.

## Files touched

This canonical roadmap record only; new remediation intake records only if concrete residual work is discovered and captured through `ki-next`.

## Verify

Run the named focused audits and `ki-authoring`; retain exact commands, exit outcomes and finding identities. Every historical concern must have cited evidence or an explicit unknown and a proposed disposition. No source code or repository setting may change in this investigation.

## Dependencies / blocks

No build-order dependency for the investigation. Missing historical or remote evidence is a reportable result, not an excuse to claim the concern resolved.

## Documentation impact

### Decision Records

Inspect existing decisions; no adoption, exception or new policy Decision Record is authorized by this review.

### Specifications

No behavior changes; record any residual contract gap as proposed follow-on work.

### Guides

No operator guide change: deliver the assessment in the work record; later approved remediation owns any guide updates.

### Roadmap

Keep this item as the execution authority; record delivery and review evidence here without accepting or pruning other work.

## Discussion

Review the evidence before deciding whether to repair, defer, or document an exception.

### Pickup checkpoint — 2026-09-28

At local `main` `9b3d58654f6e2948a02df89a3601736fb714aac2`, `c00ad947bbe276ea998c32204874843d91ed820f` added `docs/decisions/GDR-MCP-GIT-001-adopting-decision-records.md` and its `docs/decisions/README.md` index; `8a251feb6933bafa6943c1ae42666b6e8621e47e` composed the managed `.gitignore`. A fresh `ki repo audit --repo .` passed all 21 selected skills, including `ki-decision-records` and `ki-repo`. These are current mechanical and historical delivery evidence for two cited concerns, not proof that the original estate findings or GitHub metadata judgment concern were fully resolved; their exact criteria were unavailable in this record.

Remaining: recover or restate the original finding identities, compare their Decision Record, ignore-file, and GitHub metadata criteria against current evidence, then seek the owner's repair, deferral, or exception decision. No executable suite was run for this documentation-only audit. Before implementation, reconcile destination `main`, linked tasks, and retained worktrees; only the primary worktree was visible locally, and remote task ownership was unavailable. Missing evidence does not release a claim or lift a hold. This checkpoint is pickup guidance, not execution block or resumption authority. Draft/Future state remains unchanged; eventual closure requires review and explicit owner acceptance, with any Done record retained until separately selected for pruning.

### Readiness review

The approved planning boundary is an evidence reconciliation and recommendation. It does not pre-approve repairs, exceptions or terminal dispositions. Existing pickup evidence remains historical, not a current result.
