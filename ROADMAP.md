# Roadmap

Forward-looking plans only. Shipped features live in [README.md](./README.md); release history lives in [CHANGELOG.md](./CHANGELOG.md).

## Next Up

- `repo_fetch` companion tool — run `git fetch` across the same tree so `behind`
  counts in `repo_audit` reflect true remote state. Kept separate from `repo_audit`
  so the audit stays read-only and fast.

## Future Advanced Capabilities

- Worktree-pointer `.git` files (currently skipped — v1 only handles `.git` directories).
- Stash / submodule state in the per-repo payload.
- Multi-root audit in a single call (currently one root per call; multi-root is
  configuration only).

## Tooling
