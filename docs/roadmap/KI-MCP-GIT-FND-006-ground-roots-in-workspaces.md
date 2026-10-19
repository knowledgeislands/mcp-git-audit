---
id: KI-MCP-GIT-FND-006
area: FND
title: Ground roots in workspaces
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-19T06:49:00Z
updated_at: 2026-10-19T06:49:00Z
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

## Dependencies / blocks

Not blocked, and blocks nothing. The Kit Git Repo Audit artifact in Personal Principal is being regrounded in `~/workspaces` in parallel; it reads whatever safe roots the deployed configuration sets, not this repository's default.

## Discussion

### Default for a public package

`~/workspaces` is the Knowledge Islands convention, not a universal one. Defaulting to it narrows reach for KI users and, for anyone else, starts from a root that may not exist. Decide whether a missing default root should fail clearly at startup, warn and fall back to `~`, or simply return empty scans, and say which in the installing guide.

### Configured roots in the dotfiles

The deployed list names each territory separately and so needs an edit for every new territory; a single `~/workspaces` root plus `~/.local/share/chezmoi` would be equivalent under the current layout, apart from any other folders directly under `~/workspaces`. Raise it with the dotfiles owner rather than changing it here.
