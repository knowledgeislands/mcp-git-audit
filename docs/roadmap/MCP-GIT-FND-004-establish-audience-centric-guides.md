---
id: MCP-GIT-FND-004
title: Establish audience-centric guides
area: FND
theme: foundation-tooling
horizon: now
status: ready
blocks: []
blocked_by: []
transferred_from: ki-website
baseline_ref: null
created_at: 2026-09-21T15:44:00Z
updated_at: 2026-09-22T06:53:20Z
---

## Goal

A reader can find practical instructions for this server grouped by the audience that needs them, and the repository declares `ki-guides` so that grouping is gated rather than conventional.

## Context

`mcp-git-audit` has no `docs/guides/` and does not declare `ki-guides`. Its README carries the whole practical account across Features, Available Tools, Configuration, Claude Desktop config, and Development — roughly 400 lines that serve orientation and instruction at once.

KI Website now declares, for every page it publishes under `apps/site/src/guidance/`, the exact upstream document and pinned ref that page was written from, and a `verify:guidance --network` sweep reports the pages whose source has moved. The site intends to derive public guidance for this project from this repository's own guides and cite them at a pinned ref, so the quality and stability of `docs/guides/` here directly determines the quality of what the site can publish.

That is a pull, not an obligation: KI Website derives, it does not own. This repository decides what its guides say and when they change.

Separately, `ki-guides` is being asked to require audience directories under `docs/guides/` rather than permitting a flat collection (`ki-agentic-harness` `KI-HARNESS-GOV-083`). If that lands, this repository's collection has to satisfy it.

## Boundary

Adopted into `Now` by explicit approval, so this is prioritised work rather than intake. It remains `status: draft`: `ki-plan` shapes it to `Ready` before any implementation, and this repository still owns its plan and sequencing.

KI Website derives and cites; it does not own this collection and must not be given approval rights over it. Nothing here requires a guide to be written for the website's benefit — if a guide would not serve this repository's own readers, it should not exist.

## Current state

There is no `docs/guides/` directory and `.ki.toml` declares no `[skills.ki-guides]` block, so nothing gates whether the collection exists or what shape it takes. The practical material catalogued in Context sits in `README.md`, where a reader arriving with a task has to reconstruct that task out of reference prose.

## Steps

- [ ] Name the audiences as `user` and `developer`, and record why no `operator` split is written.
- [ ] Create `docs/guides/README.md` as the collection index, routing by audience and nothing else.
- [ ] Create `docs/guides/user/README.md` and `docs/guides/developer/README.md` as audience entry points.
- [ ] Write `docs/guides/user/installing-the-server.md`: install, client configuration, safe roots, first verification.
- [ ] Write `docs/guides/user/auditing-repositories.md`: the scan, audit, detail, and diff workflow and its caching and truncation behaviour.
- [ ] Write `docs/guides/user/granting-write-access.md`: access levels, `dry_run`, `force_mode`, and the audit log.
- [ ] Write `docs/guides/user/troubleshooting.md`: rejected roots, missing tools, timeouts, authentication failures, per-repository errors.
- [ ] Write `docs/guides/developer/working-on-the-code.md`: setup, dev loop, and gates, linking `CONTRIBUTING.md` rather than restating it.
- [ ] Write `docs/guides/developer/architecture.md`: layering, config injection, the access gate, and the path-safety invariants.
- [ ] Reduce `README.md` to orientation: what the server is, what it can do, its safety posture, and links into the guides.
- [ ] Declare `[skills.ki-guides]` in `.ki.toml`.
- [ ] Run the guides and authoring audits and repair what they report.

## Files touched

`docs/guides/` (new), `.ki.toml`, `README.md`.

## Verify

`ki repo audit --skill ki-guides --repo .` passes, `ki repo audit --skill ki-authoring --repo .` passes over the new Markdown, and the full `ki repo audit --repo .` still passes, at sixteen declared skills rather than the fifteen it passes at today.

## Dependencies / blocks

Nothing blocks this. `KI-HARNESS-GOV-083` in `ki-agentic-harness` proposes making audience directories a `ki-guides` requirement: if it lands first this collection satisfies it by construction, and if it lands later this collection already conforms. KI Website intends to derive public guidance from these guides and cite them at a pinned ref, but it derives rather than owns and its schedule does not gate this work.

## Documentation impact

### Decision Records

No decision record is needed. Audience-centric grouping is the house arrangement `ki-guides` already encodes, so adopting it here is conformance rather than a new decision. One becomes owed only if this repository concludes it needs an exception.

### Specifications

No behaviour-level contract changes, and none are authored here: the server's tool surface is untouched, and this repository declares no `ki-specs` corpus. Removing the hand-maintained per-tool schema reference from the README does leave this repository with no tracked behaviour contract for its tool surface, which is a real gap routed to `ki-specs` rather than repaired by a guide restating the schemas. See the `### The tool inventory` topic below.

### Guides

This item is entirely guide impact. It creates the collection, its audience directories, and their indexes, and it empties the README of instruction.

### Roadmap

Two follow-on captures are expected rather than none, and neither is executed here. The first is a `ki-specs` corpus for the tool surface, which the Specifications note above routes. The second is a sweep of the in-repository cross-references that point at the README for installation and configuration — `AGENTS.md` ("Keep user-facing installation, configuration, and tool reference in README") and `CLAUDE.md` ("The user-facing tool surface, install/config, and Claude Desktop setup live in README.md") — both of which become wrong the moment this item lands. Those files sit outside this item's approved file scope, so capture is a separate act by `ki-next`.

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
