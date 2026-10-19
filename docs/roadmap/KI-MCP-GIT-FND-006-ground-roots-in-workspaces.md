---
id: KI-MCP-GIT-FND-006
area: FND
title: Ground roots in workspaces
purpose: corrective
kind: deliver
status: done
size: s
blocks: []
blocked_by: []
baseline_ref: 5e946c4e05b473eb7e43e0b5f10080a46a9f807f
created_at: 2026-10-19T06:49:00Z
updated_at: 2026-10-19T23:30:01Z
---

# Ground roots in workspaces

## Goal

The server's default reach, its examples and its guides follow the `~/workspaces/<territory>/<repository>` layout every Knowledge Islands workstation now uses, so an unconfigured or newly configured install audits the right repositories without reaching across the whole home directory.

## Context

Handoff from Knowledge Islands Principal's Observatory Project (work file `ki.observatory`), raised under Kris's decision of 19 October 2026 (EXT-ROOTS): "as recommended, the mcp-git-audit needs updating too. everything is now grounded in `~/workspaces`."

Evidence read on 19 October 2026:

- `src/config/index.ts:92`: `DEFAULT_SAFE_ROOTS = '~'`, so an unset `MCP_GIT_AUDIT_SAFE_ROOTS` allows the whole home directory; `src/config/index.test.ts` pins that default.
- `.env.example:12` and `docs/guides/user/granting-write-access.md:36` use `~/dev`; `docs/guides/user/installing-the-server.md` (lines 26-64) describes the `~` default and uses `~/dev` and `~/dev:~/work` as examples; `docs/guides/user/auditing-repositories.md:19` says the `max_depth` default of 2 suits a `~/dev/<org>/<repo>` layout; `docs/guides/README.md:18` describes the home-directory default; `claude-config-sample.json:7` uses placeholder roots.
- The chezmoi-rendered configuration, read only (`.chezmoidata/mcp-servers.yaml` in the dotfiles source, entry `mcp-git-audit`), sets `MCP_GIT_AUDIT_SAFE_ROOTS` to one root per territory under `~/workspaces` (`equal-remedy`, `humans-not-robots`, `knowledge-islands`, `legal`, `personal`, `sacred-inquiry`, `techmedix`, `valle-armonia`), plus `~/workspaces/_external` and `~/.local/share/chezmoi`, at access level `destructive`, for Claude Desktop and mcporter.

## Boundary

In scope: change the unset default from `~` to `~/workspaces` with its test; move the examples and guides to the `~/workspaces/<territory>/<repository>` layout, noting that the `max_depth` default of 2 fits it; and state in the installing guide how to add a root outside `~/workspaces`, such as the chezmoi source.

Out of scope: the chezmoi-rendered configuration, which the dotfiles repository owns; whether it collapses its per-territory list into `~/workspaces` is that repository's call. Also out of scope: the Kit Git Repo Audit live artifact in Personal Principal, which has its own handoff, and any change to containment, metadata authorisation or the access-level gate.

## Current state

Read on 20 October 2026: an unset or blank `MCP_GIT_AUDIT_SAFE_ROOTS` still resolves to `~` (`src/config/index.ts`, `DEFAULT_SAFE_ROOTS`), and `src/config/index.test.ts` pins it twice. The walk in `src/main/repo-audit/scan.ts` already treats a missing directory as an empty subtree, and `git_repos_audit_roots` already reports a missing root per root, without failing the call. So a default root that does not exist needs no new code path.

## Steps

- [x] Change `DEFAULT_SAFE_ROOTS` to `~/workspaces`, with its comment, and update both default tests in `src/config/index.test.ts`.
- [x] Move `.env.example`, `claude-config-sample.json`, and the user guides (installing, granting write access, auditing repositories) and `docs/guides/README.md` to the `~/workspaces/<territory>/<repository>` layout, saying that the `max_depth` default of 2 fits it.
- [x] In the installing guide, state the missing-root behaviour decided below, and show how to add a root outside `~/workspaces`, such as `~/.local/share/chezmoi`.
- [x] Add a changelog line if the repository keeps an unreleased section, and run the gate.

## Files touched

- `src/config/index.ts`, `src/config/index.test.ts`.
- `.env.example`, `claude-config-sample.json`, `docs/guides/README.md`, `docs/guides/user/installing-the-server.md`, `docs/guides/user/granting-write-access.md`, `docs/guides/user/auditing-repositories.md`; `CHANGELOG.md` if it has an unreleased section.
- This record.

## Verify

- The default tests expect `~/workspaces` resolved against the home directory, for unset and blank values.
- The gate in [Working on the code](../guides/developer/working-on-the-code.md#gates) passes: `ki repo audit --repo .`, `bun run test`, `bun run test:coverage` at 100%, `bun run ki:test:smoke`.
- No guide or example names `~/dev` or describes the home-directory default.

## Dependencies / blocks

Not blocked, and blocks nothing. The Kit Git Repo Audit artifact in Personal Principal is being regrounded in `~/workspaces` in parallel; it reads whatever safe roots the deployed configuration sets, not this repository's default.

## Documentation impact

### Decision Records

None.

### Specifications

None; the repository keeps no specification for configuration defaults.

### Guides

The installing, granting-write-access and auditing guides and the guides index move to the `~/workspaces` layout.

### Roadmap

This record moves to Awaiting review at delivery.

## Review

### Delivered

An unset or blank `MCP_GIT_AUDIT_SAFE_ROOTS` now defaults to `~/workspaces`, and every example and guide uses the `~/workspaces/<territory>/<repository>` layout. Baseline `5e946c4e05b473eb7e43e0b5f10080a46a9f807f`; the delivery commit follows it. The deployed chezmoi configuration is untouched.

### Change Summary

- `src/config/index.ts`: `DEFAULT_SAFE_ROOTS` is `~/workspaces`; the comment states the missing-root behaviour.
- `src/config/index.test.ts`: both default tests expect `~/workspaces`.
- `.env.example`, `claude-config-sample.json`, the guides index and the installing, granting-write-access and auditing guides: `~/workspaces` examples; the installing guide states the missing-root behaviour and shows adding `~/.local/share/chezmoi`.
- `CHANGELOG.md`: one Unreleased line.
- No deviation from the plan.

### Verification

- `bun run test`: 247 of 247 pass. `bun run test:coverage`: 100%. `bun run ki:test:smoke`: pass.
- `ki repo audit --repo .`: no failures; three pre-existing warnings (`.rumdl.toml` drift, Claude Desktop binding, inline CI `KI_VERSION` pin).
- No guide or example names `~/dev` or the home-directory default.

### Outstanding concerns

None for this record. Collapsing the deployed per-territory list into `~/workspaces` stays with the dotfiles owner, as Discussion says.

### Post-change review

The change narrows the unset default only; containment, authorisation and the access gate are unchanged, and an explicit setting behaves as before.

### Mini recap

Default root moved from `~` to `~/workspaces` with docs; missing-root behaviour reuses the existing empty-scan path, decided under HIGH-APPLY.

## Done

Accepted 2026-10-20 by Kris, under TO-DONE and the coordinator’s explicit acceptgit2 grant, on the review packet above.

## Discussion

### Independent acceptance

Independently verified by acceptgit2 on 20 October 2026 against delivery commit `6a48d6e` and baseline `5e946c4e05b473eb7e43e0b5f10080a46a9f807f`: `ki repo audit --repo .` passed with no failures and the two pre-existing OWN-1 and CLAUDEBIND-1 warnings; `bun run test` passed all 247 tests; `bun run test:coverage` passed at 100% for statements, branches, functions and lines; `bun run ki:test:smoke` passed. Exact assertions confirm the unset and blank defaults resolve `~/workspaces` against the home directory; the guides and examples contain neither `~/dev` nor the old home-directory default. Existing missing-root scan and batch-audit fixtures pass. The change meets the Goal and Boundary, with no acceptance concern.

Closure authority: Kris’s TO-DONE decision of 20 October, recorded in `ki-principal/+/_WORK/ki.tools-burndown/decisions.md`, requires an independent accept pass. The coordinator’s 00:25 BST instruction for acceptgit2 explicitly says: “this run may accept and prune KI-MCP-GIT-FND-006 after its independent checks pass”. Pruning remains separate from acceptance: cross-repository preflight found live absolute links in two untracked reports belonging to other sessions in `ki-principal`, so the Done record is retained until their owner pins those links.

### Default for a public package

`~/workspaces` is the Knowledge Islands convention, not a universal one. Defaulting to it narrows reach for KI users and, for anyone else, starts from a root that may not exist. Decide whether a missing default root should fail clearly at startup, warn and fall back to `~`, or simply return empty scans, and say which in the installing guide.

Decided under HIGH-APPLY, 20 October: a missing default root behaves exactly as a missing configured root does today. Scans return nothing and `git_repos_audit_roots` reports the root as missing; the server neither fails at startup nor falls back. Falling back to `~` would silently widen reach, which the change exists to narrow, and failing at startup would break an unconfigured install that a single setting fixes. The installing guide says so.

### Configured roots in the dotfiles

The deployed list names each territory separately and so needs an edit for every new territory; a single `~/workspaces` root plus `~/.local/share/chezmoi` would be equivalent under the current layout, apart from any other folders directly under `~/workspaces`. Raise it with the dotfiles owner rather than changing it here.
