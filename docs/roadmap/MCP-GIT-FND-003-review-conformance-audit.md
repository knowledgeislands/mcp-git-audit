---
id: MCP-GIT-FND-003
title: Review conformance audit
area: FND
theme: foundation-tooling
horizon: next
status: done
blocks: []
blocked_by: []
baseline_ref: f89fc0d027d098f745c6354c772d102dc8507327
created_at: 2026-09-04T08:53:59Z
updated_at: 2026-10-02T02:20:58Z
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

- [x] Inventory each historical concern separately; search repository history, retained decisions and local audit evidence for the original rule, finding ID, observed fact and acceptance criterion. Mark unrecoverable evidence explicitly rather than inventing it.
- [x] Run fresh focused `ki-repo`, `ki-decision-records`, `ki-git` and `ki-work-roadmap` audits and inspect the source supporting each relevant finding. Read GitHub metadata only if a concern requires it and authenticated read access is available; record unavailable remote evidence as unknown.
- [x] Write a concern-by-concern assessment in this record with source locations, current observation, remaining gap and proposed repair/defer/exception decision. Distinguish mechanical passes, judgment findings and historical unknowns.
- [x] Present the assessment for owner review. Capture any substantive remediation through the normal roadmap intake process; do not implement fixes or self-dispose historical concerns under this investigation.

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

## Review

### Delivered

Completed the approved evidence-reconciliation boundary for MCP-GIT-FND-003 at baseline `f89fc0d027d098f745c6354c772d102dc8507327`. The result is a concern-by-concern assessment and owner recommendation in this record; historical implementation, acceptance, source fixes, remote settings changes, and pruning remain outside this delivery.

### Change Summary

Updated only `docs/roadmap/MCP-GIT-FND-003-review-conformance-audit.md` with pinned current evidence, historical limits, the recommendation, completed investigation steps, and this review packet. No deviation from the planned boundary.

### Verification

Focused `ki-repo`, `ki-decision-records`, `ki-git`, `ki-work-roadmap`, and `ki-authoring` audits passed at the pinned baseline. Read-only GitHub metadata was inspected where a hosted concern was named. No application code, hosting setting, or external service was changed.

### Outstanding concerns

Original estate-audit finding identifiers and judgment criteria are missing from the retained item. The recommendation is limited to current observed conformance; no reproducible remaining local repair was identified.

### Post-change review

The record now answers its review goal with sourced current observations and explicit limits. It does not claim that a mechanical pass accepts historical judgment or that an unrecoverable criterion was met. The delivery is ready for the owner's acceptance decision on this review packet.

### Mini recap

Reconciled retained conformance concerns against the current repository and proposed the narrow disposition above. Required review audits passed; any reviewed failing contract is identified in Outstanding concerns. Further policy changes or repairs must use their named owner and normal work selection.

## Done

Accepted 2026-10-02 by Kris Brown on the review packet above.

## Discussion

Review the evidence before deciding whether to repair, defer, or document an exception.

### Pickup checkpoint — 2026-09-28

At local `main` `9b3d58654f6e2948a02df89a3601736fb714aac2`, `c00ad947bbe276ea998c32204874843d91ed820f` added `docs/decisions/GDR-MCP-GIT-001-adopting-decision-records.md` and its `docs/decisions/README.md` index; `8a251feb6933bafa6943c1ae42666b6e8621e47e` composed the managed `.gitignore`. A fresh `ki repo audit --repo .` passed all 21 selected skills, including `ki-decision-records` and `ki-repo`. These are current mechanical and historical delivery evidence for two cited concerns, not proof that the original estate findings or GitHub metadata judgment concern were fully resolved; their exact criteria were unavailable in this record.

Remaining: recover or restate the original finding identities, compare their Decision Record, ignore-file, and GitHub metadata criteria against current evidence, then seek the owner's repair, deferral, or exception decision. No executable suite was run for this documentation-only audit. Before implementation, reconcile destination `main`, linked tasks, and retained worktrees; only the primary worktree was visible locally, and remote task ownership was unavailable. Missing evidence does not release a claim or lift a hold. This checkpoint is pickup guidance, not execution block or resumption authority. Draft/Future state remains unchanged; eventual closure requires review and explicit owner acceptance, with any Done record retained until separately selected for pruning.

### Readiness review

The approved planning boundary is an evidence reconciliation and recommendation. It does not pre-approve repairs, exceptions or terminal dispositions. Existing pickup evidence remains historical, not a current result.

### Evidence reconciliation — 2026-10-01

The delivery baseline is local `main` `f89fc0d027d098f745c6354c772d102dc8507327`. The retained earlier pickup is historical evidence. Fresh focused audits ran at this baseline; `ki-git` contains judgment prompts that a reported PASS does not itself decide. The original estate-audit finding IDs and full acceptance criteria were not recoverable from this canonical record; each limit is stated below.

- **Decision Records adoption.** The retained commit `c00ad947bbe276ea998c32204874843d91ed820f` added the adoption record and index. The current `ki-decision-records` audit passes. Recommend no repeat adoption; original judgment criteria were not retained.

- **Managed ignore rules.** The retained commit `8a251feb6933bafa6943c1ae42666b6e8621e47e` composed `.gitignore`. The current `ki-repo` audit passes. Recommend no repeat ignore-file repair; exact former finding ID is unavailable.

- **Hosted metadata.** Read-only GitHub API shows public visibility, `main`, MIT licence, the declared description, and branch deletion enabled. The description and visibility match `.ki.toml`; the original metadata finding did not name the exact disputed field. Recommend no host write without that criterion and an exact settings diff.

**Recommendation.** No source or hosting change is justified by the retained evidence. The owner may accept a current-conformance finding with the original historical judgment left explicitly unverified.
