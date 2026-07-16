# Foundation tooling roadmap

## Blocking

Actively broken, or blocking the `Next` horizon: takes priority over everything else and must clear before `Next` work proceeds. Empty means nothing is on fire.

## Next

Scoped and ready to start — the immediate queue, picked up before anything in **Soon** or **Future**.

### Adopt uniform governance modes and bootstrap

Replace the stale project-local skill command paths with the current coverage-scoped bootstrap and aggregate command model. Preserve the working MCP test baseline and record the outcome in the harness-level MCP rollout plan.

## Soon

Understood and roughly scoped but not yet started — worth doing once the **Next** queue clears, ahead of anything still speculative.

### Close remaining coverage gap

Close the coverage gap to satisfy the 100% Vitest threshold (currently 97.4% lines and 92.3% branches). The major gaps are environment-parse error paths in [config/index.ts](../../../src/config/index.ts) and rotation arms in [audit-log.ts](../../../src/utils/audit-log.ts).

### Add wire-level smoke test

Add `bun run ki:test:smoke` to boot the built server and verify that the wire-level tool surface matches in-process registration, then run it in CI.

## Waiting for

Worth doing, but presently blocked on an external dependency or decision. Revisit when its named condition changes rather than treating it as dormant local work.

## Future

Speculative or not yet scoped — items marked _(candidate)_ need a scoping pass (or a decision to drop them) before they're actionable.
