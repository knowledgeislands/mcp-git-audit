# Changelog

## Unreleased

### Added

- `git_repo_diff` (read) — structured per-file diff for unstaged or staged changes. Each entry carries status, additions, deletions, and the unified patch body. `max_lines` budget caps the total output; over-budget files report `diff: null` and `truncated: true`.
- `git_repo_commit` (destructive) — stage selected files (`stage: all_tracked | all | paths | none`) and create a commit in one call. `dry_run: true` is the default — the staging step still runs (the index is local, fully reversible state) and `git commit --dry-run` is invoked so no object is written. No `--amend` in v1.
- `DESTRUCTIVE_ONESHOT` annotation preset for tools whose effect depends on current FS / index state (destructive, non-idempotent).
