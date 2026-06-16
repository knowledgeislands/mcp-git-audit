# Roadmap

Forward-looking plans only. Shipped features live in [README.md](./README.md); release history lives in the git log.

## Next Up

## Future Advanced Capabilities

- Worktree-pointer `.git` files (currently skipped — v1 only handles `.git` directories).
- Stash / submodule state in the per-repo payload.
- Multi-root audit in a single call (currently one root per call; multi-root is configuration only).

## Tooling

- Close coverage gap to satisfy the 100% vitest threshold (currently 97.4% lines / 92.3% branches). Major gaps: `config/index.ts` env-parse
  error paths and `audit-log.ts` rotation arms (kb-fs and m365 ship the same pattern — see their `/* v8 ignore */` on the rotateIfNeeded
  TOCTOU arm).
- Smoke test (`bun run test:smoke`) — boot the built server and verify the wire-level tool surface matches in-process registration.
  mcp-gmail has the reference implementation (`scripts/smoke.ts` + CI step); git-audit lacks both.
