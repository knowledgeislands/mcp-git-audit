# mcp-git-audit

[![CI](https://github.com/knowledgeislands/mcp-git-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/knowledgeislands/mcp-git-audit/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@knowledgeislands/mcp-git-audit.svg)](https://www.npmjs.com/package/@knowledgeislands/mcp-git-audit) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An MCP (Model Context Protocol) server that walks a tree of git repositories and returns branch, working-tree status, ahead/behind, and last-commit metadata for each — and (opt-in at deploy time) can run remote/branch mutations (`fetch`, `pull`, `push`, `remote add/set-url/remove`). Every walked path is validated against a configurable allow-list of safe roots, so the server cannot reach into directories outside that allow-list — even if asked to.

The read-only audit work is split across two tools — `git_repos_scan` (cheap filesystem walk) and `git_repos_audit` (per-repo `git` checks) — so a single scan can be cached and re-audited many times without paying the walk cost again.

## Features

- **Read-only by default** — every tool ships with MCP tool annotations driving an access-level gate (`MCP_GIT_AUDIT_ACCESS_LEVEL`). The mutating tools are hidden until the operator opts in.
- **Split scan/audit pipeline** — `git_repos_scan` does only the filesystem walk; `git_repos_audit` consumes a scan result and runs the `git` calls. Cache the scan output and re-audit on demand.
- **Path safety in two layers** — `~` expansion plus realpath normalisation, applied to every safe root, every `root` argument, and every `abs_path` re-supplied to `audit` / remote ops / sync ops. A cached scan cannot widen the security boundary.
- **Tight identifier validation** — remote names, branch names, and remote URLs go through regex schemas that reject `-` prefixes (option-injection guard), `..` sequences, and control characters.
- **`dry_run` defaults to `true` on every mutating tool.** Where git supports `--dry-run` natively (`fetch`, `push`) we pass it through; for `pull` we approximate via `git fetch --dry-run`.
- **`force_mode` enum, not a boolean** — `git_repo_push` exposes `force_mode: 'none' | 'with_lease' | 'force'`, so the caller can't accidentally non-FF-push by flipping a checkbox.
- **Per-call timeouts** — local `git` calls are bounded at 8s; network ops (`fetch`, `pull`, `push`) at 60s. Interactive credential prompts are disabled (`GIT_TERMINAL_PROMPT=0`) so an auth-required remote fails fast instead of hanging.
- **Error isolation** — per-repo failures (e.g. a corrupt `.git/HEAD`) are aggregated into the result's `errors[]` rather than failing the whole call.

## Available Tools

The level column shows the minimum `MCP_GIT_AUDIT_ACCESS_LEVEL` at which the tool registers. The default level is `read`, so the `write` and `destructive` tools are hidden unless the operator opts in.

| Tool                      | Level       | Description†                                                       |
| ------------------------- | ----------- | ------------------------------------------------------------------ |
| `git_repos_scan`          | read        | Walk a tree for `.git` dirs and return repo metadata. No `git`.    |
| `git_repos_audit`         | read        | Per-repo `git` checks (branch, status, ahead/behind, last commit). |
| `git_repo_detail`         | read        | Commit history + working-tree file listing for one repo.           |
| `git_repo_diff`           | read        | Structured per-file diff (status, +/-, patch) for staged/unstaged. |
| `git_repo_remotes_list`   | read        | List configured remotes with fetch + push URLs.                    |
| `git_repo_fetch`          | write       | `git fetch` — updates remote-tracking refs only.‡                  |
| `git_repo_remote_add`     | write       | Add a new remote (rejects if it already exists).                   |
| `git_repo_remote_set_url` | write       | Change an existing remote's fetch or push URL.                     |
| `git_repo_commit`         | destructive | Stage selected files and create a commit (`dry_run` default true). |
| `git_repo_pull`           | destructive | `git pull` — modifies working tree + current branch.‡              |
| `git_repo_push`           | destructive | `git push` — modifies remote refs. `force_mode` enum gates force.  |
| `git_repo_remote_remove`  | destructive | Drop a remote's config and `refs/remotes/<name>/*`.                |

† Every mutating tool defaults `dry_run=true`. Pass `dry_run: false` to actually make the change.

‡ Network ops; bounded by a 60s timeout. `GIT_TERMINAL_PROMPT=0` is set, so an auth-required remote returns an error rather than hanging.

### `git_repos_scan`

```json
{
  "name": "git_repos_scan",
  "arguments": { "root": "~/dev", "max_depth": 2 }
}
```

#### Input

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `root` | string | — | Optional when exactly one entry is configured in `MCP_GIT_AUDIT_SAFE_ROOTS`. Otherwise required, and must equal or live inside one of those entries. |
| `max_depth` | number | 2 | Max depth (from `root`) at which a repo directory may live. |

#### Output

```ts
{
  root: string // resolved absolute root
  scanned_at: string // ISO-8601 UTC
  repos: Array<{
    path: string // relative to root, forward slashes
    abs_path: string // absolute path on disk
    group: string // first path segment, or "(root)" for repos directly in root
    name: string // last path segment
  }>
}
```

### `git_repos_audit`

```json
{
  "name": "git_repos_audit",
  "arguments": {
    "scan": {
      "root": "/Users/me/dev",
      "scanned_at": "2026-05-14T...",
      "repos": [/* ... */]
    }
  }
}
```

#### Input

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `scan` | object | — | A previous result from the `git_repos_scan` tool. Every `abs_path` is revalidated against `MCP_GIT_AUDIT_SAFE_ROOTS` before any `git` call. |
| `include_stale_days` | number | 30 | Reserved — currently unused; the consumer computes stale itself. |

#### Output

```ts
{
  root: string;                // resolved absolute root (pulled from the scan)
  scanned_at: string;          // ISO-8601 UTC — when the scan ran
  audited_at: string;          // ISO-8601 UTC — when this audit ran
  repos: Array<{
    path: string;              // relative to root, forward slashes
    group: string;
    name: string;
    branch: string;            // branch name, or "detached@<short-sha>" when detached
    detached: boolean;
    sha: string;               // short SHA of HEAD
    subject: string;           // last commit subject
    rel_date: string;          // e.g. "3 hours ago"
    iso_date: string;          // ISO-8601 committer date
    modified: number;
    untracked: number;
    has_remote: boolean;
    has_upstream: boolean;
    ahead: number;
    behind: number;
  }>;
  errors?: Array<{ path: string; message: string }>;
}
```

Errors:

- `root "<X>" is not inside any configured safe_root (...)` — the supplied `root` (or any `abs_path` in `scan.repos`) escapes every entry in `MCP_GIT_AUDIT_SAFE_ROOTS`.
- `root must be an absolute path or start with ~/: "<X>"` — relative paths are rejected.
- `root is required when multiple safe_roots are configured (...)` — only omittable when exactly one safe root is configured.

### `git_repo_detail`

```json
{
  "name": "git_repo_detail",
  "arguments": {
    "abs_path": "/Users/me/dev/myrepo",
    "commits": 10,
    "include_diffstat": false
  }
}
```

#### Input

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `abs_path` | string | — | Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit` result. Revalidated against `MCP_GIT_AUDIT_SAFE_ROOTS` before any `git` call. |
| `commits` | number | 10 | Recent commits to return, newest first. Hard cap 50. |
| `include_diffstat` | boolean | false | When true, include per-commit `diffstat[]` (added/removed/path) from `git log --numstat`. `files` count is always returned. |

#### Output

```ts
{
  abs_path: string;
  path: string;                       // relative to safe_root, forward slashes
  fetched_at: string;                 // ISO-8601 UTC
  commits: Array<{
    sha: string;                      // short SHA
    subject: string;
    author: string;                   // name only
    iso_date: string;                 // committer date, ISO-8601
    rel_date: string;                 // e.g. "3 hours ago"
    files: number;                    // count of files touched
    diffstat?: Array<{ added: number; removed: number; path: string }>;  // present iff include_diffstat=true
  }>;
  working_tree: {
    modified: Array<{ status: string; path: string }>;  // raw two-char git status --porcelain code
    summary: { modified: number; untracked: number };
  };
  error?: string;                     // present on timeout or git failure; commits/working_tree still returned
}
```

Timeout and per-call errors surface in the `error` field rather than throwing, so the artifact can degrade gracefully. A repo with no commits returns `commits: []` without an error.

### `git_repo_diff`

Read-only structured diff. Returns one entry per changed file, each with `status` (M/A/D/R…), `additions`, `deletions`, and the unified patch body. Internally runs three `git diff` invocations (`--numstat -z`, `--name-status -z`, and unified patch) and merges the results by path — `paths` are then passed through unchanged in numstat order so callers can pair entries directly.

`max_lines` is a budget across all files. Once a file's diff would push the running total over the cap, that file's `diff` becomes `null` and its `truncated` flag is set; subsequent files are likewise null+truncated. The top-level `truncated` is the disjunction over file entries.

| Name        | Type     | Default | Notes                                                                                        |
| ----------- | -------- | ------- | -------------------------------------------------------------------------------------------- |
| `abs_path`  | string   | —       | Absolute path to a git repo inside `MCP_GIT_AUDIT_SAFE_ROOTS`.                               |
| `staged`    | boolean  | `false` | `false` → `git diff` (unstaged); `true` → `git diff --cached` (staged).                      |
| `paths`     | string[] | —       | Repo-relative pathspec to narrow the diff. Leading `-` / `/` and `..` segments are rejected. |
| `max_lines` | number   | 500     | Cap on total diff body lines across all files. Max 2000.                                     |

Output:

```ts
{
  abs_path: string
  staged: boolean
  fetched_at: string // ISO-8601 UTC
  total_additions: number
  total_deletions: number
  truncated: boolean // true iff any file entry was truncated
  files: Array<{
    path: string // repo-relative, forward slashes (new path on a rename)
    status: string // M / A / D / R<score> / C<score> / T / U …
    additions: number
    deletions: number
    diff: string | null // unified patch body; null when truncated
    truncated: boolean
  }>
}
```

### `git_repo_remotes_list`

Read-only listing of remotes. Input: `{ abs_path }`. Output: `{ abs_path, fetched_at, remotes: [{ name, fetch_url, push_url }] }`. `push_url` differs from `fetch_url` only when a push override was configured via `set-url --push`.

### `git_repo_fetch`

Update remote-tracking refs (no working-tree changes). Requires `MCP_GIT_AUDIT_ACCESS_LEVEL=write` (or higher).

| Name          | Type    | Default  | Notes                                                                        |
| ------------- | ------- | -------- | ---------------------------------------------------------------------------- |
| `abs_path`    | string  | —        | Absolute path to a git repo inside `MCP_GIT_AUDIT_SAFE_ROOTS`.               |
| `remote`      | string  | `origin` | Ignored when `all_remotes=true`. Pattern `[A-Za-z0-9_.-]`, no leading `-/.`. |
| `prune`       | boolean | `false`  | Pass `--prune`.                                                              |
| `tags`        | boolean | `false`  | Pass `--tags`.                                                               |
| `all_remotes` | boolean | `false`  | Pass `--all`. Overrides `remote`.                                            |
| `dry_run`     | boolean | `false`  | Pass `--dry-run` to git itself.                                              |

Output includes the executed argv (`command`), `stdout`, and `stderr` (git writes the useful "refs updated" lines on stderr).

### `git_repo_commit`

Stage a set of files and create a commit in one call. Destructive — writes a commit object and moves HEAD when `dry_run=false`. Requires `MCP_GIT_AUDIT_ACCESS_LEVEL=destructive`. Designed to back a commit-artifact UX where the preview step calls `git_repo_diff` + `git_repo_commit` (`dry_run=true`) and the confirm step re-calls with `dry_run=false`.

`dry_run=true` (the default) runs the staging step normally but invokes `git commit --dry-run` — git prints what would be committed without writing an object or moving HEAD. The index mutation done by the staging step is local-only state and is fully reversible with `git reset`; treating it as part of the preview is intentional, because the artifact preview needs to reflect the post-stage state.

No `--amend` in v1 — amending rewrites history and complicates the push flow (would need force-with-lease). Adding it later requires an explicit `amend: true` flag with its own warning copy.

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `abs_path` | string | — | Absolute path to a git repo inside `MCP_GIT_AUDIT_SAFE_ROOTS`. |
| `message` | string | — | Commit message. Single-line in v1 (no `\n` support). |
| `stage` | `"all_tracked"` \| `"all"` \| `"paths"` \| `"none"` | `"all_tracked"` | `all_tracked` → `git add -u`. `all` → `git add -A`. `paths` → `git add -- <paths>` (requires `paths`). `none` → commit the index as-is. |
| `paths` | string[] | — | Required when `stage="paths"`, rejected otherwise. Repo-relative paths. Leading `-` / `/` and `..` segments are rejected as an option-injection guard. |
| `dry_run` | boolean | `true` | When true, runs `git commit --dry-run` — no commit object is written and HEAD does not move. The staging step still runs. |
| `allow_empty` | boolean | `false` | Pass `--allow-empty`. Off by default — an empty commit is almost always a mistake. |

Output:

```ts
{
  abs_path: string;
  ran_at: string;               // ISO-8601 UTC
  dry_run: boolean;
  stage: "all_tracked" | "all" | "paths" | "none";
  staged_paths: string[];       // files actually staged at commit time
  message: string;
  command: string[];            // the commit argv (git + flags + -m + message)
  sha: string | null;           // short SHA of new HEAD; null on dry-run
  stdout: string;
  stderr: string;
}
```

### `git_repo_pull`

Update the working tree from a remote. Destructive — requires `MCP_GIT_AUDIT_ACCESS_LEVEL=destructive`. Defaults `ff_only=true` so a divergent upstream aborts cleanly; `rebase=true` opts in to rewriting local commits. `ff_only` and `rebase` are mutually exclusive.

| Name        | Type    | Default  | Notes                                                                                                 |
| ----------- | ------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `abs_path`  | string  | —        | Absolute path to a git repo inside `MCP_GIT_AUDIT_SAFE_ROOTS`.                                        |
| `remote`    | string  | `origin` |                                                                                                       |
| `branch`    | string  | current  | Required when HEAD is detached.                                                                       |
| `rebase`    | boolean | `false`  | Pass `--rebase`. Rewrites local history.                                                              |
| `ff_only`   | boolean | `true`   | Pass `--ff-only`. Abort instead of producing a merge commit.                                          |
| `autostash` | boolean | `false`  | Pass `--autostash`.                                                                                   |
| `dry_run`   | boolean | `true`   | When true, runs `git fetch --dry-run` against the same remote/branch — `git pull` has no `--dry-run`. |

### `git_repo_push`

Update remote refs. Destructive — requires `MCP_GIT_AUDIT_ACCESS_LEVEL=destructive`. `--force` is gated behind `force_mode`, not a boolean, to make accidental non-FF pushes harder.

| Name           | Type                                    | Default  | Notes                                                          |
| -------------- | --------------------------------------- | -------- | -------------------------------------------------------------- |
| `abs_path`     | string                                  | —        | Absolute path to a git repo inside `MCP_GIT_AUDIT_SAFE_ROOTS`. |
| `remote`       | string                                  | `origin` |                                                                |
| `branch`       | string                                  | current  | Required when HEAD is detached.                                |
| `force_mode`   | `"none"` \| `"with_lease"` \| `"force"` | `"none"` | `with_lease` is safer; `force` overwrites unconditionally.     |
| `set_upstream` | boolean                                 | `false`  | Pass `--set-upstream`.                                         |
| `tags`         | boolean                                 | `false`  | Pass `--tags`.                                                 |
| `delete`       | boolean                                 | `false`  | Pass `--delete` to delete the branch on the remote.            |
| `dry_run`      | boolean                                 | `true`   | Pass `--dry-run` to git itself.                                |

### `git_repo_remote_add`

Create a new remote. Requires `MCP_GIT_AUDIT_ACCESS_LEVEL=write`. Non-idempotent — fails if the name already exists.

| Name       | Type    | Default | Notes                                                                               |
| ---------- | ------- | ------- | ----------------------------------------------------------------------------------- |
| `abs_path` | string  | —       | Absolute path to a git repo inside `MCP_GIT_AUDIT_SAFE_ROOTS`.                      |
| `remote`   | string  | —       | New remote name. Pattern `[A-Za-z0-9_.-]`, no leading `-/.`.                        |
| `url`      | string  | —       | URL for the new remote. Must not start with `-`; whitespace/control chars rejected. |
| `dry_run`  | boolean | `true`  | When true (default), no mutation.                                                   |

### `git_repo_remote_set_url`

Change an existing remote's URL. Requires `MCP_GIT_AUDIT_ACCESS_LEVEL=write`. Idempotent.

| Name       | Type    | Default | Notes                                                                             |
| ---------- | ------- | ------- | --------------------------------------------------------------------------------- |
| `abs_path` | string  | —       | Absolute path to a git repo inside `MCP_GIT_AUDIT_SAFE_ROOTS`.                    |
| `remote`   | string  | —       | Existing remote name.                                                             |
| `url`      | string  | —       | New URL. Must not start with `-`; whitespace/control chars rejected.              |
| `push`     | boolean | `false` | When true, update only the push URL (`git remote set-url --push`).                |
| `dry_run`  | boolean | `true`  | When true (default), no mutation; the call returns the current entry as `before`. |

### `git_repo_remote_remove`

Drop a remote. Requires `MCP_GIT_AUDIT_ACCESS_LEVEL=destructive`. Working-tree files are untouched.

| Name       | Type    | Default | Notes                                                          |
| ---------- | ------- | ------- | -------------------------------------------------------------- |
| `abs_path` | string  | —       | Absolute path to a git repo inside `MCP_GIT_AUDIT_SAFE_ROOTS`. |
| `remote`   | string  | —       | Existing remote name to remove.                                |
| `dry_run`  | boolean | `true`  | When true (default), no mutation.                              |

## Configuration

| Env var | Required | Notes |
| --- | --- | --- |
| `MCP_GIT_AUDIT_SAFE_ROOTS` | no | Colon-separated list of absolute or `~/...` paths the tool is allowed to walk. May list several. Defaults to `~` (the user's home directory) when unset or empty. |
| `MCP_GIT_AUDIT_ACCESS_LEVEL` | no | Maximum tool access level to register. One of: `read` (default — read-only audit + diff + remotes-list), `write` (adds `git_repo_fetch`, `git_repo_remote_add`, `git_repo_remote_set_url`), `destructive` (adds `git_repo_commit`, `git_repo_pull`, `git_repo_push`, `git_repo_remote_remove`). Each tool's level is derived from its MCP annotations (`readOnlyHint` / `destructiveHint`); a tool registers when its derived level ≤ the configured level. The `dry_run: true` default on destructive tools controls _effect_; this gate controls _visibility_. Unknown values abort startup. |
| `MCP_GIT_AUDIT_AUDIT_LOG` | no | Audit-log scope. One of `off`, `writes` (default — record only non-read tool calls), `all` (record every invocation). |
| `MCP_GIT_AUDIT_AUDIT_LOG_PATH` | no | Path to the JSONL audit log. Default `~/.local/state/mcp-git-audit/audit.jsonl`. |
| `MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES` | no | Size-based rotation threshold in bytes. Default `10485760` (10 MiB). Set to `0` to disable rotation. |
| `MCP_GIT_AUDIT_AUDIT_LOG_KEEP` | no | Number of rotated audit-log files to retain. Default `5`. |

Any `root` argument (and every `abs_path` re-supplied to `git_repos_audit`) must equal or live inside one of the safe roots after `~` expansion and `realpath`-style normalisation; otherwise the call returns an error. When only one safe root is configured, `root` may be omitted on the `git_repos_scan` call.

## Claude Desktop config

```json
{
  "mcpServers": {
    "mcp-git-audit": {
      "command": "node",
      "args": ["/path/to/mcp-git-audit/dist/mcp-server/index.js"],
      "env": {
        "MCP_GIT_AUDIT_SAFE_ROOTS": "~/dev"
      }
    }
  }
}
```

A copyable version of this is in [`claude-config-sample.json`](./claude-config-sample.json).

## Development

```bash
bun install                       # install deps
bun run ki:server:mcp:dev            # bun --watch (NODE_ENV=development)
bun run ki:server:mcp:inspect        # MCP Inspector against the dev server
bun run test                      # vitest (use `bun run`, not `bun test`)
bun run test:coverage             # vitest + v8 coverage
bun run ki:lint:types                # tsc --noEmit
bun run ki:lint:check                # Biome lint + format check
bun run ki:lint:fix                  # Biome auto-fix
bun run ki:lint:md                   # prettier + markdownlint for *.md
bun run build                     # emit dist/
bun run ki:server:mcp:start          # build + run from dist/ under node
```

## License

MIT — see [LICENSE](./LICENSE).
