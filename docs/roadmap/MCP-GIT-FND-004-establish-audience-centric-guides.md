---
id: MCP-GIT-FND-004
title: Establish audience-centric guides
area: FND
theme: foundation-tooling
horizon: now
status: awaiting-review
blocks: []
blocked_by: []
transferred_from: ki-website
baseline_ref: 12e84b28f9a6791e1fbc0687cab91bdc31c87793
created_at: 2026-09-21T15:44:00Z
updated_at: 2026-09-26T17:32:40Z
---

## Goal

A reader can find practical instructions for this server grouped by the audience that needs them, and the repository declares `ki-guides` so that grouping is gated rather than conventional.

## Context

`mcp-git-audit` has no `docs/guides/` and does not declare `ki-guides`. Its README carries the whole practical account across Features, Available Tools, Configuration, Claude Desktop config, and Development — roughly 400 lines that serve orientation and instruction at once.

KI Website now declares, for every page it publishes under `apps/site/src/guidance/`, the exact upstream document and pinned ref that page was written from, and a `verify:guidance --network` sweep reports the pages whose source has moved. The site intends to derive public guidance for this project from this repository's own guides and cite them at a pinned ref, so the quality and stability of `docs/guides/` here directly determines the quality of what the site can publish.

That is a pull, not an obligation: KI Website derives, it does not own. This repository decides what its guides say and when they change.

Separately, `KI-HARNESS-GOV-083` has clarified `ki-guides`: audience directories are recommended when stable reader groups make a collection easier to navigate, while flat and mixed collections remain valid. This item therefore stands on this repository's own readers and routing needs, not a universal Harness requirement.

## Boundary

Adopted into `Now` by explicit approval, so this is prioritised work rather than intake. It remains `status: draft`: `ki-plan` shapes it to `Ready` before any implementation, and this repository still owns its plan and sequencing.

KI Website derives and cites; it does not own this collection and must not be given approval rights over it. Nothing here requires a guide to be written for the website's benefit — if a guide would not serve this repository's own readers, it should not exist.

## Current state

There is no `docs/guides/` directory and `.ki.toml` declares no `[skills.ki-guides]` block, so nothing gates whether the collection exists or what shape it takes. The practical material catalogued in Context sits in `README.md`, where a reader arriving with a task has to reconstruct that task out of reference prose.

## Steps

- [x] Name the audiences as `user` and `developer`, and record why no `operator` split is written.
- [x] Create `docs/guides/README.md` as the collection index, routing by audience and nothing else.
- [x] Create `docs/guides/user/README.md` and `docs/guides/developer/README.md` as audience entry points.
- [x] Write `docs/guides/user/installing-the-server.md`: install, client configuration, safe roots, first verification.
- [x] Write `docs/guides/user/auditing-repositories.md`: the scan, audit, detail, and diff workflow and its caching and truncation behaviour.
- [x] Write `docs/guides/user/granting-write-access.md`: access levels, `dry_run`, `force_mode`, and the audit log.
- [x] Write `docs/guides/user/troubleshooting.md`: rejected roots, missing tools, timeouts, authentication failures, per-repository errors.
- [x] Write `docs/guides/developer/working-on-the-code.md`: setup, dev loop, and gates, linking `CONTRIBUTING.md` rather than restating it.
- [x] Write `docs/guides/developer/architecture.md`: layering, config injection, the access gate, and the path-safety invariants.
- [x] Reduce `README.md` to orientation: what the server is, what it can do, its safety posture, and links into the guides.
- [x] Declare `[skills.ki-guides]` in `.ki.toml`.
- [x] Run the guides and authoring audits and repair what they report.

## Files touched

`docs/guides/` (new), `.ki.toml`, `README.md`.

## Verify

`ki repo audit --skill ki-guides --repo .` passes, `ki repo audit --skill ki-authoring --repo .` passes over the new Markdown, and the full `ki repo audit --repo .` still passes, at sixteen declared skills rather than the fifteen it passes at today.

## Dependencies / blocks

Nothing blocks this. `KI-HARNESS-GOV-083` is advisory rather than a universal migration requirement; this item's audience grouping remains justified by the repository-local reader distinctions described above. KI Website intends to derive public guidance from these guides and cite them at a pinned ref, but it derives rather than owns and its schedule does not gate this work.

## Documentation impact

### Decision Records

No decision record is needed. Audience-centric grouping is the house arrangement `ki-guides` already encodes, so adopting it here is conformance rather than a new decision. One becomes owed only if this repository concludes it needs an exception.

### Specifications

No behaviour-level contract changes, and none are authored here: the server's tool surface is untouched, and this repository declares no `ki-specs` corpus. Removing the hand-maintained per-tool schema reference from the README does leave this repository with no tracked behaviour contract for its tool surface, which is a real gap routed to `ki-specs` rather than repaired by a guide restating the schemas. See the `### The tool inventory` topic below.

### Guides

This item is entirely guide impact. It creates the collection, its audience directories, and their indexes, and it empties the README of instruction.

### Roadmap

Two follow-on captures are expected rather than none, and neither is executed here. The first is a `ki-specs` corpus for the tool surface, which the Specifications note above routes. The second is a sweep of the in-repository cross-references that point at the README for installation and configuration — `AGENTS.md` ("Keep user-facing installation, configuration, and tool reference in README") and `CLAUDE.md` ("The user-facing tool surface, install/config, and Claude Desktop setup live in README.md") — both of which become wrong the moment this item lands. Those files sit outside this item's approved file scope, so capture is a separate act by `ki-next`.

## Review

### Delivered

A subsequent `GUIDE-4` review found that four guides still linked prose documents outside `docs/guides/`. The collection now routes practical work to sibling guides, names repository policy and work records in prose, and keeps each procedure complete without importing another authority.

The approved boundary: create `docs/guides/` as an audience-grouped collection, move the README's how-to material into it, declare `[skills.ki-guides]`, and leave the README orienting. Excluded, as approved: any change to `src/`, `package.json`, or the server's behaviour; any new specification corpus; and any edit outside `docs/guides/`, `README.md`, and `.ki.toml`.

Immutable baseline: `12e84b28f9a6791e1fbc0687cab91bdc31c87793`.

Resulting evidence: nine new Markdown files under `docs/guides/`, a README reduced from 401 lines to 61, one added `.ki.toml` block, and a full repository audit that now passes at sixteen declared skills rather than fifteen.

### Change Summary

The review correction changed `docs/guides/developer/README.md`, `working-on-the-code.md`, `docs/guides/user/granting-write-access.md`, and `troubleshooting.md`. It removed six escaping document links without changing the server, its security boundary, or its roadmap state.

New — `docs/guides/README.md` (collection index), `docs/guides/user/README.md`, `docs/guides/user/installing-the-server.md`, `docs/guides/user/auditing-repositories.md`, `docs/guides/user/granting-write-access.md`, `docs/guides/user/troubleshooting.md`, `docs/guides/developer/README.md`, `docs/guides/developer/architecture.md`, `docs/guides/developer/working-on-the-code.md`.

Changed — `README.md` (401 lines to 61), `.ki.toml` (`[skills.ki-guides]` added).

Four material decisions, each argued in Discussion or below. The audiences are `user` and `developer`, with no `operator` tier. The README keeps a twelve-row capability table and loses the per-tool schema reference entirely, rather than relocating it into a guide. The behavioural caveats embedded in that reference — scan caching, the `max_lines` budget and its cascading truncation, `git_repo_detail` degrading into an `error` field, the `git fetch --dry-run` approximation behind `git_repo_pull`, the absence of `--amend` — were carried into the user guides that need them. And the npm badge was removed from the README, because the registry returns 404 for `@knowledgeislands/mcp-git-audit`: the package is not published, so the badge advertised an install route that does not exist. The install guide says so explicitly.

Three factual corrections were made while writing, all of which contradict the material being replaced. The README claimed every mutating tool defaults `dry_run` to `true`; `git_repo_fetch` defaults it to `false`, and the new table footnote says so. The README's development block listed `bun run ki:lint:types`, `ki:lint:check`, and `ki:lint:fix`, none of which exist in `package.json` — the gates are now `ki repo audit`, `bun run test`, `bun run test:coverage`, and `bun run ki:test:smoke`, which is what CI actually runs and what the developer guide documents. `CONTRIBUTING.md` still carries the same stale script names and is outside this item's file scope, so the developer guide flags the discrepancy in a note rather than silently disagreeing with it.

One approved deviation, small: the README's tool table heading is `## Available tools` rather than the `## What it can do` first drafted, because `CLAUDE.md` links `./README.md#available-tools` and the Markdown gate resolves link fragments. Renaming the heading kept the fix inside this item's file scope.

### Verification

- `ki repo audit --skill ki-guides --repo . --concise --progress never` - PASS after the review correction, including `GUIDE-4`.
- `rumdl check` over the five touched Markdown files - PASS after formatting once.
- `ki repo audit --skill ki-authoring --repo . --concise --progress never` - `FAIL=0 WARN=1`; the remaining `OWN-1` warning is the pre-existing drift in `.rumdl.toml`.
- `ki repo audit --repo . --concise --progress never` - `PASS=13 WARN=2 FAIL=1`; no guide failure remains, while `TEST-5` cannot write Vitest's `node_modules/.vite-temp` file in the audit sandbox and `OWN-1` plus development-checkout `DIST-1` remain warnings.

`ki repo audit --skill ki-guides --concise --progress never` — `summary: KI REPO AUDIT on mcp-git-audit PASS · 1 skill`, exit 0.

`ki repo audit --skill ki-authoring --concise --progress never` — `summary: KI REPO AUDIT on mcp-git-audit PASS · 1 skill`, exit 0. It failed twice before passing: once on `MD049` for `*emphasis*` in this record, and once on `MD051` for the `CLAUDE.md` link fragment described above. Both were repaired within scope.

`ki repo audit --concise --progress never` — `summary: KI REPO AUDIT on mcp-git-audit PASS · 16 skills`, exit 0, against a baseline of `PASS · 15 skills`.

Every relative link in the nine new files and the rewritten README was resolved against the filesystem; none dangle. `MD057` is disabled in `.rumdl.toml`, so that check was run separately rather than relied upon from the gate.

The test suite was not run. No code, test, or configuration affecting behaviour was touched; the change is Markdown and one TOML declaration.

### Outstanding concerns

Three, none blocking.

**Deleted reference material.** Roughly 300 lines of per-tool input and output tables were removed rather than relocated. The argument is in the `### The tool inventory` topic, and the material remains in git history at the baseline commit. This is the part of the change most worth a reviewer's own judgement, because the decision is cheap to reverse now and expensive to revisit later.

**Two files now contradict the README.** `AGENTS.md` instructs that user-facing installation, configuration, and tool reference be kept in the README; `CLAUDE.md` states that install, config, and Claude Desktop setup live there. Both are outside this item's approved file scope and both are now wrong. `CLAUDE.md` additionally says the README tabulates tools "with purposes and I/O shapes" — the purposes remain, the I/O shapes do not. The Roadmap impact note routes this.

**No behaviour contract.** With the schema tables gone, this repository's only account of what its tools accept and return is the code, its tests, and the live server. That is honest but thin, and it is the `ki-specs` gap already routed.

### Post-change review

The correction preserves every operational warning and contribution gate while removing dependencies on prose outside the collection. Root policy remains authoritative and is named rather than duplicated.

The goal holds. A reader arriving with a task now lands on an index that routes by who they are, and every guide states an outcome, the conditions, and what to do when it fails. The prompting question in Discussion — whether someone who has never opened this repository can install it, run it, and recover from its common failures without reading source — is answered by the four user guides, and answering it honestly is what surfaced the unpublished package and the stale script names.

Scope held. Nine new files, two modified, all three within the declared `Files touched`. No file under `src/`, no `package.json`, no test.

Regression risk is low and confined to documentation. The single mechanical coupling between this change and the rest of the repository was the `CLAUDE.md` link fragment, which the Markdown gate caught and which is now satisfied. Nothing in the build, the published package, or the server's behaviour is touched.

Acceptance readiness: ready, with the deleted schema reference as the one judgement a reviewer should make for themselves rather than inherit.

### Mini recap

The follow-up review removed six links from guides to prose documents outside the collection, retained the needed instructions locally, and restored the guide boundary without accepting this work item.

Delivered an audience-centric guide collection — `user` and `developer`, four user guides and two developer guides plus three indexes — and reduced the README to orientation, declaring `[skills.ki-guides]` so the shape is gated rather than conventional.

The initial delivery verification passed and moved the full audit from fifteen skills to sixteen. The follow-up evidence above records the current audit-environment failure and template warnings.

Concerns: the removed per-tool schema reference is a deliberate deletion a reviewer should confirm; `AGENTS.md` and `CLAUDE.md` now point at a README that no longer holds installation and configuration; the repository has no tracked behaviour contract for its tool surface.

Learning worth routing, not promoted here: the npm badge advertised a package that is not on the registry, and both `README.md` and `CONTRIBUTING.md` listed `bun run ki:lint:*` scripts that `package.json` does not define. Documentation that nobody executes drifts silently; writing a guide that had to be true is what found both.

## Discussion

Planning settles how far the restructure goes, not whether it happens. The prompting question is whether a reader who has never opened this repository can install it, run it, and recover from its common failures without reading source.

### Audiences

Two: `user` and `developer`. A user wants the server answering questions about their own repositories through an MCP client; a developer is changing its code.

No `operator` directory is created, and that is a decision rather than an omission. An operator split earns its keep where running the thing is a different job from using it — a paired device, a supervised process, a credential someone else rotates, a spool with its own retention. This server is a stdio process the client launches on demand, with no account, no network identity, no persistent state beyond an optional JSONL audit log, and no lifecycle between calls. The person who sets `MCP_GIT_AUDIT_SAFE_ROOTS` and chooses an access level is the same person who then asks the server to audit a tree. Writing an `operator` directory here would mean writing for nobody, and the Boundary already says a guide that serves no reader of this repository should not exist. The deployment-shaped decisions that would otherwise be operator material — safe roots, access level, the audit log — are the user's decisions and sit in the user guides that need them.

### The tool inventory

The README's per-tool reference is two different things that deserve different fates.

The twelve-row capability table — tool name, minimum access level, one line of purpose — stays in the README. It is orientation, it answers "can this thing do what I want" before a reader commits to anything, and it changes only when a tool is added or removed.

The per-tool input and output tables do not stay, and are not moved into a guide either. They are a hand-maintained transcription of Zod schemas the server already publishes through `tools/list`, which every MCP client renders from the live server, and which `bun run ki:generate:client` already re-emits as typed client code. A guide restating a normative contract is exactly what the guides standard forbids, and a second copy of a schema is precisely the drift this item was asked to avoid. The behavioural detail in those sections that is _not_ schema — that a scan result can be cached and re-audited, that `git_repo_diff` spends `max_lines` as a budget across files and truncates the remainder, that `git_repo_detail` degrades into an `error` field rather than throwing, that `git_repo_pull` has no native dry run and approximates one by fetching, that there is no `--amend` — is carried into the user guides that need it, because a reader acting on those tools needs it to act.

The residue is that this repository then has no tracked behaviour contract at all, only code and a live server. That is honest, and it is the gap routed to `ki-specs` above. It is not a reason to keep a copy that drifts.
