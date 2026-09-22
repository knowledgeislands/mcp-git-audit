# mcp-git-audit

[![CI](https://github.com/knowledgeislands/mcp-git-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/knowledgeislands/mcp-git-audit/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An MCP (Model Context Protocol) server that walks a tree of local git repositories and reports branch, working-tree status, ahead/behind, and last-commit metadata for each — so you can ask a model what state your repositories are in and get an answer grounded in `git` rather than in recollection. Opt in at deploy time and it will also make changes: fetch, commit, pull, push, and remote configuration.

Every path it touches is validated against a configurable allow-list of safe roots, including paths handed back to it from an earlier result, so the server cannot reach outside that allow-list even when asked to. Mutating tools are not registered at all until an operator raises the access level, and they preview by default when they are.

The read-only audit work is split across two tools — `git_repos_scan` for the filesystem walk and `git_repos_audit` for the per-repository `git` calls — so one scan can be cached and re-audited many times without paying for the walk again.

## Available tools

The level column is the minimum `MCP_GIT_AUDIT_ACCESS_LEVEL` at which each tool is registered. The default is `read`, so the seven `write` and `destructive` tools are absent unless an operator opts in.

| Tool                      | Level       | Purpose                                                            |
| ------------------------- | ----------- | ------------------------------------------------------------------ |
| `git_repos_scan`          | read        | Walk a tree for `.git` directories. Runs no `git`.                 |
| `git_repos_audit`         | read        | Per-repo branch, status, ahead/behind, and last commit.            |
| `git_repo_detail`         | read        | Commit history and working-tree listing for one repository.        |
| `git_repo_diff`           | read        | Structured per-file diff, staged or unstaged.                      |
| `git_repo_remotes_list`   | read        | Configured remotes with their fetch and push URLs.                 |
| `git_repo_fetch`          | write       | `git fetch` — updates remote-tracking refs only.†                  |
| `git_repo_remote_add`     | write       | Add a remote. Fails if the name already exists.                    |
| `git_repo_remote_set_url` | write       | Change an existing remote's fetch or push URL.                     |
| `git_repo_commit`         | destructive | Stage selected files and create a commit.                          |
| `git_repo_pull`           | destructive | `git pull` — changes the working tree and current branch.‡         |
| `git_repo_push`           | destructive | `git push` — changes remote refs. Force is gated by an enum.‡      |
| `git_repo_remote_remove`  | destructive | Drop a remote's configuration and remote-tracking refs.            |

† Every mutating tool except this one defaults `dry_run` to `true`; `git_repo_fetch` defaults it to `false`, because a fetch changes nothing outside remote-tracking refs.

‡ Network operations, bounded by a 60-second timeout. `GIT_TERMINAL_PROMPT=0` is set, so a remote that wants credentials returns an error rather than hanging.

Each tool's parameters, defaults, and descriptions are published by the running server and rendered by your MCP client. This repository keeps no second copy of them.

## Safety posture

- **Read-only by default.** Access level is derived from each tool's MCP annotations, and a tool above the configured level is never registered — a model cannot call what it cannot see. An unannotated tool is treated as destructive, so forgetting to annotate hides a tool rather than exposing it.
- **Path safety in two layers.** `~` expansion plus realpath normalisation, applied to every safe root, every `root` argument, and every absolute path re-supplied from an earlier result. A cached scan cannot widen the boundary.
- **Previews by default.** Mutating tools default `dry_run` to `true` and pass git's native `--dry-run` through where one exists. `git_repo_push` gates force behind `force_mode: 'none' | 'with_lease' | 'force'` rather than a boolean.
- **Tight identifier validation.** Remote names, branch names, and URLs are rejected when they begin with `-`, contain `..`, or carry control characters. `git` is invoked through an argv array, never a shell string.
- **Bounded calls.** Local `git` calls time out at 8 seconds, network operations at 60, all capped by `maxBuffer`.
- **Error isolation.** A per-repository failure — a corrupt `.git/HEAD`, a timeout — is aggregated into the result's `errors[]` instead of failing the whole call.

## Getting started

There is no published package yet: install from source, wire the built `dist/mcp-server/index.js` into your MCP client, and set `MCP_GIT_AUDIT_SAFE_ROOTS` to the directories it may read. [Installing the server](docs/guides/user/installing-the-server.md) walks through it, including the Claude Desktop block, which is also in [`claude-config-sample.json`](./claude-config-sample.json).

## Documentation

- [Guides](docs/guides/README.md) — the practical instructions, grouped by who needs them.
  - [User guides](docs/guides/user/README.md) — installing, auditing a tree, granting write access, troubleshooting.
  - [Developer guides](docs/guides/developer/README.md) — architecture, invariants, the local loop and its gates.
- [Decision records](docs/decisions/README.md) — why the repository is arranged as it is.
- [Roadmap](docs/roadmap/) — what is planned and in flight.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — commit conventions and what CI expects.
- [`SECURITY.md`](./SECURITY.md) — the responsibility split, and how to report a vulnerability.

## License

MIT — see [LICENSE](./LICENSE).
