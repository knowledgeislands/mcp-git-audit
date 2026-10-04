# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Multi-repository discovery and audit across configured workspace roots.
- Per-repository detail and diff inspection.
- Gated commit, fetch, pull, and push.
- Remote listing, addition, removal, and URL changes.
- Discovery of linked worktrees and other `.git` pointer files, with every `gitdir` and `commondir` target authorised against the safe roots before any `git` call; escaping or malformed metadata is reported as unsupported.
- `git_repos_audit` declares its `errors[]` entries as `{ path, message }` objects, matching what it returns.
- `git_repos_audit` reports a retained-stash count and a bounded first-level submodule summary (expected and actual commit, state, dirty flag) per repository; unavailable states are never reported as zero.
- Changed: the parent working-tree status in `git_repos_audit` ignores submodules, so submodule changes are reported in `submodules` rather than counted as modified files.
