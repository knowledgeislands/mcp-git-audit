---
id: MCP-GIT-BATCH-001
repository: https://github.com/knowledgeislands/mcp-git-audit
approved: true
approved_at: 2026-08-29T23:46:22Z
authority_mode: outcome
authority_evidence: User instructed the agent to prepare and progress more roadmap work under the established autonomous batch and consolidated-acceptance contract.
approved_payload_sha256: f6abd00c8db4152ce6c348cf9658dd45a713a6fa83c83010cc2c1c81fb7e3054
run_id: MCP-GIT-BATCH-001-RUN-001
timebox_ends_at: 2026-08-30T02:46:22Z
item_ids: [MCP-GIT-TOOL-005]
completion_target: done
mandatory_stops: [material-scope-expansion, destructive-or-irreversible-work, external-coordination, verification-failure, unapproved-decision, push-or-release]
closure_item_ids: [MCP-GIT-TOOL-005]
---

# MCP-GIT-BATCH-001 — Pilot MCP SDK v2

## Outcome authority

Deliver `MCP-GIT-TOOL-005` as a stable local stdio pilot and return exact evidence for `KI-HARNESS-GOV-006`. Keep publication, release, push, remote transport, sibling writes, and fleet policy outside the run.

## Selected plan

1. `MCP-GIT-TOOL-005` — migrate the server and smoke client to the released SDK v2 package family; use the supported connection-pinned stdio factory; add required result envelopes and discovery evidence; retain tool names, annotations, access gates, Git/filesystem safety, and Node-hosted stdio operation.

Mutable scope is limited to the selected roadmap record, package manifest and lockfile, MCP entry point, result helpers, focused protocol fixtures, operator documentation only where the local interface changes, and this authorization ledger.

## Excluded

- Publishing, tagging, pushing, or releasing.
- Remote HTTP transport or authentication.
- Sibling-repository writes or fleet-wide conformance policy.
- Real user-root Git operations or credential use.
- Protocol features unrelated to the stdio migration proof.

## Required verification

- Focused result-envelope and stdio protocol tests.
- `bun run test:coverage`.
- `bunx tsc --noEmit`.
- `bunx biome check`.
- `bun run build` and `bun run ki:test:smoke`.
- `ki repo audit --skill ki-repo-mcp --repo .`.
- `ki repo audit --skill ki-engineering --repo .`.
- `ki repo audit --skill ki-work-roadmap --repo .`.
- `ki repo audit --skill ki-authoring --repo .`.

## Completion and remedial policy

The record must reach `awaiting-review` with its six-part review packet and then close through `ki-accept` under this run. Non-blocking improvements become separate receiver-owned work rather than preventing a viable verified pilot from closing.

## Run ledger

<!-- ki-batch-run: MCP-GIT-BATCH-001-RUN-001 f6abd00c8db4152ce6c348cf9658dd45a713a6fa83c83010cc2c1c81fb7e3054 -->
