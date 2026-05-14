# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is maintained automatically by [release-please](https://github.com/googleapis/release-please) — entries below are generated from [Conventional Commits](https://www.conventionalcommits.org/) on `main`. Edit only when manually overriding release-please output.

## [1.0.0] - 2026-05-14

### Added

- Initial release.
- Two MCP tools, split for cache-friendly use:
  - `scan` — walks a directory tree for `.git` directories and returns repo metadata (`path`, `abs_path`, `group`, `name`). No `git` invocations.
  - `audit` — consumes a `scan` result and runs the per-repo `git` checks (branch, working-tree status, ahead/behind, last commit). Per-repo failures are aggregated into the `errors[]` array rather than failing the whole call.
- `MCP_GIT_AUDIT_SAFE_ROOTS` (colon-separated) confines both tools to one or more allow-listed roots; any `root` argument and every `abs_path` re-supplied to `audit` is `~`-expanded, realpath-normalised, and rejected if it escapes every safe root. Defaults to `~` (the user's home directory) when unset or empty.
