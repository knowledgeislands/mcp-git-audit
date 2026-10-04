# Granting write access

Let the server change something — fetch, commit, pull, push, or reconfigure a remote — and understand what you have actually agreed to. Start from [Installing the server](installing-the-server.md); this guide only changes one environment variable and explains the consequences.

## Two safeguards, not one

The server has two independent brakes, and confusing them is the most common mistake.

`MCP_GIT_AUDIT_ACCESS_LEVEL` controls **visibility**. It is read once at startup, and any tool above the configured level is never registered with the client at all. A model cannot call it, cannot see it, and cannot be persuaded into it: the tool does not exist in that session.

`dry_run` controls **effect**. It is a per-call parameter on the mutating tools, and on almost all of them it defaults to `true`, so the first call previews and a second, explicit call performs.

The first is your decision, made once, in your client configuration. The second is a decision made per call, in the conversation. Neither substitutes for the other. A destructive-level install with `dry_run` respected is still a server that can push; a read-level install cannot push no matter what any prompt says.

## Choosing a level

The levels nest, each adding to the one below.

| Level         | Adds                                                                                     | What that means                                           |
| ------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `read`        | the five audit and inspection tools                                                       | nothing in any repository changes†                        |
| `write`       | `git_repo_fetch`, `git_repo_remote_add`, `git_repo_remote_set_url`                         | remote-tracking refs and remote configuration change      |
| `destructive` | `git_repo_commit`, `git_repo_pull`, `git_repo_push`, `git_repo_remote_remove`              | history, the working tree, and remote refs change         |

† The default. It is also the right level for the most common use, which is asking what state a tree of repositories is in.

Set it in the client's `env` block and restart the client:

```json
{
  "mcpServers": {
    "mcp-git-audit": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-git-audit/dist/mcp-server/index.js"],
      "env": {
        "MCP_GIT_AUDIT_SAFE_ROOTS": "~/dev",
        "MCP_GIT_AUDIT_ACCESS_LEVEL": "write"
      }
    }
  }
}
```

An unrecognised value aborts startup rather than falling back, so a typo presents as a server that will not start. Confirm the change took by asking the client to list its tools: `read` shows five, `write` eight, `destructive` twelve.

A level is derived from each tool's own MCP annotations rather than from its name, so the split above is a property of what a tool does, not of what it is called.

## At `write`: fetching and remotes

`git_repo_fetch` updates remote-tracking refs and touches nothing else. It is the tool that makes the ahead/behind numbers in an audit trustworthy, which is the usual reason to leave `read`. It is also the one mutating tool whose `dry_run` defaults to **`false`**, because a real fetch changes nothing you would want to undo; pass `dry_run: true` if you want to confirm reachability without updating refs.

`git_repo_remote_add` and `git_repo_remote_set_url` change remote configuration and both default to `dry_run: true`. Adding is non-idempotent and fails if the name already exists; setting a URL is idempotent, and its dry run returns the current entry as `before` so you can see exactly what would be replaced. The `push` flag on `set_url` changes only the push URL, leaving fetch alone.

Remote names and URLs go through tight validation: anything starting with `-` is rejected as an option-injection guard, as are `..` sequences and control characters. A rejected remote name is a safety check firing, not a bug.

## At `destructive`: commits, pulls, and pushes

All four destructive tools default to `dry_run: true`.

**`git_repo_commit`** commits exactly the files you name, and nothing else. It is built for working trees shared with other people and agents: `paths` is required, and whatever someone else has staged, edited or left untracked stays out of the commit and survives it unchanged.

The `stage` parameter chooses how the commit is built. The default, `paths`, starts from `HEAD` and takes the working-tree content of each named path, so another actor's staged entries cannot ride along. `prepared_index` commits the index as you staged it, but only when the staged set equals `paths` exactly; otherwise the call refuses and lists the extra and missing paths. The old broad modes `all_tracked`, `all` and `none` have been removed rather than aliased, so a stale client fails validation instead of sweeping up the whole tree: replace `none` with `prepared_index` plus the staged paths, and the others with an explicit `paths` list.

Paths must be literal, repo-relative files. Directories, pathspec magic (`:`, `*`, `?`, `[`), `..` segments and a leading `-` or `/` are rejected, and each path must exist in the working tree or be tracked at `HEAD` - a tracked file you deleted is a valid path and commits the deletion. Every bad path is listed in `rejected_paths` and nothing happens. Named paths that match `HEAD` are reported in `skipped_paths`.

The dry run is a true preview. Both the preview and the commit are built in a temporary index inside the repository's Git directory, which is removed after every call, so a preview leaves your real index byte-for-byte unchanged. After a real commit, only the committed paths' entries in the real index are updated to their committed content, as `git commit --only` would. A preview grants nothing: every call revalidates, calls to one repository are serialised, and a call refuses if `HEAD` moves while it is being prepared.

Hooks run as normal. If a hook changes what gets committed - a pre-commit hook that stages another file, say - the result is `ok: false` with the commit's SHA and `hook_modified_paths`. The commit is kept as made; the server never resets, amends or rewrites it, so deciding what to do with it is yours. A failed hook leaves `HEAD` and the real index as they were.

There is no `--amend`. Amending rewrites history and forces the push flow into force-with-lease territory, so it was left out rather than added quietly.

**`git_repo_pull`** defaults to `ff_only: true`, so a diverged upstream aborts cleanly instead of producing a merge commit you did not ask for. `rebase: true` opts into rewriting local commits, and the two are mutually exclusive — asking for both is an error, not a precedence rule. Its dry run is an approximation: `git pull` has no native `--dry-run`, so the server runs `git fetch --dry-run` against the same remote and branch instead. That tells you whether the remote is reachable and what would come down; it does not tell you whether the merge or rebase would apply cleanly.

**`git_repo_push`** gates force behind an enum rather than a boolean. `force_mode` is `none` by default, `with_lease` maps to `--force-with-lease`, and `force` maps to `--force` and overwrites the remote unconditionally. The enum exists precisely so that force cannot be reached by flipping something that looks like a checkbox. `delete: true` removes the branch on the remote and deserves the same care.

**`git_repo_remote_remove`** drops a remote's configuration and its remote-tracking refs. Working-tree files are untouched.

## Network calls fail rather than hang

`fetch`, `pull`, and `push` are bounded at sixty seconds and run with `GIT_TERMINAL_PROMPT=0`. A remote that wants credentials therefore returns an error immediately instead of blocking on a terminal prompt that does not exist — the server is launched by your client and has no console to prompt on. See [Troubleshooting](troubleshooting.md) for what that error looks like.

## What gets recorded

`MCP_GIT_AUDIT_AUDIT_LOG` writes one JSON line per invocation, and defaults to `writes` — mutating calls only. On a read-level install that default records nothing at all, which is why the log usually appears for the first time when someone raises the access level. Set it to `all` to record reads too, or `off` to disable it.

Each line carries the timestamp, tool name, derived access level, whether the call succeeded, its duration, any error, and the arguments. Two details matter for what ends up on disk: URL credentials of the `user:pass@host` form are redacted before writing, and arguments longer than 4096 characters are truncated to a preview. A failure to write the log is swallowed to stderr, deliberately — a broken log never prevents a call from completing, which also means the log is evidence rather than a guarantee.

The file defaults to `~/.local/state/mcp-git-audit/audit.jsonl` and rotates at 10 MiB, keeping five rotations. Because it is JSONL, `jq` reads it directly:

```bash
jq -r 'select(.ok == false) | "\(.ts) \(.tool) \(.error)"' ~/.local/state/mcp-git-audit/audit.jsonl
```

## Going back

Lowering the level is the same edit in reverse, followed by a client restart. There is no state to unwind: the access level is read at startup and nothing persists it.
