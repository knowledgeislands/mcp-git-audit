# Troubleshooting

The failures this server actually produces, what each one means, and how to get moving again. Most of them are a safeguard working as designed rather than a defect.

## The server does not appear at all

If the client lists no tools from `mcp-git-audit`, the process is failing to start, and the reason is almost always configuration. The server validates its environment at startup and throws rather than falling back to a default, so a bad value stops the server instead of quietly changing its behaviour. Check your client's MCP log for one of:

- `Invalid MCP_GIT_AUDIT_ACCESS_LEVEL="…". Allowed: read, write, destructive` — a typo, or a level name from another server.
- `Invalid MCP_GIT_AUDIT_AUDIT_LOG="…" expected one of: off, writes, all`.
- `Invalid MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES="…" expected non-negative integer` — the value is a byte count, not `10MB`.
- `MCP_GIT_AUDIT_SAFE_ROOTS must contain at least one path` — the value was present but held nothing usable, for example a lone `:`.

If none of those appear, the launch itself is failing. Confirm the path in `args` points at a `dist/mcp-server/index.js` that exists — an install that was cloned but never built has no `dist/` — and that `node --version` reports 22 or later for the `node` your client actually invokes, which for a GUI client is not necessarily the one on your shell's `PATH`.

## The tools I need are not listed

You are at a lower access level than the tool requires. At `read` you get five tools, at `write` eight, at `destructive` twelve. This is not a permissions error at call time: the tool was never registered, so the client cannot show it. [Granting write access](granting-write-access.md) covers raising the level, and the change needs a client restart because configuration is read once at startup.

If you changed the `env` block and nothing moved, the restart is the missing step. Note also that `.env` files are only loaded when `NODE_ENV=development`, which the development scripts set and your client does not — configuration for a client-launched server must come from the client's `env` block.

## A path was rejected

Three messages come from the path allow-list, and all three are the security boundary doing its job.

`root "<path>" is not inside any configured safe_root (…)` means the path escapes every configured entry. The check is done on the resolved real path, so this also fires for a symlink pointing outside the allow-list even when the link itself sits inside it, and for any `..` traversal. The message lists the configured roots; if the path genuinely should be reachable, add its directory to `MCP_GIT_AUDIT_SAFE_ROOTS` and restart. Widening the allow-list is a deliberate decision, not a workaround — see [Installing the server](installing-the-server.md).

`root must be an absolute path or start with ~/: "<path>"` means a relative path was supplied. The server has no meaningful working directory of its own — it is launched by the client from wherever that client happens to run — so relative paths are refused rather than resolved against something arbitrary.

`root is required when multiple safe_roots are configured (…)` means `root` was omitted while several roots are configured. It may only be omitted when there is exactly one, where the intent is unambiguous. Name the one you want.

## A repository came back in `errors[]`

`git_repos_audit` aggregates per-repository failures instead of failing the whole call, so one entry in `errors[]` alongside a full set of results is the designed behaviour, not a partial failure. The usual causes are a corrupt or unreadable `.git/HEAD`, a directory that is no longer a repository since the scan ran, a permission problem, or a `git` call that exceeded its timeout.

Look at the single repository directly with `git_repo_detail` to see which. If the cause was transient, re-running the audit against the same scan result is cheap — the filesystem walk does not need repeating.

## Something timed out

Local `git` calls are bounded at eight seconds, the metadata read behind `git_repo_detail` at six, and network operations at sixty. Nothing waits longer, by design: a bounded failure is better than a hung conversation.

A repository that times out consistently is usually very large, on a slow or network filesystem, or contending with another `git` process holding a lock. `git_repo_detail` degrades rather than throws — it returns the history and working tree it did manage to read, with an `error` field naming what it did not — so a partial result with an `error` field is still useful. Narrowing the request helps: fewer commits, or a diff restricted by pathspec.

## A fetch, pull, or push failed immediately

`git fetch failed: …`, `git pull failed: …`, and `git push failed: …` wrap whatever `git` reported, and the wrapped text is the part to read.

If it mentions authentication, credentials, or a terminal, the cause is that network operations run with `GIT_TERMINAL_PROMPT=0`. The server is a background process with no console, so an operation that would have prompted for credentials fails fast rather than hanging forever on a prompt nobody can answer. Fix it in git itself — a credential helper, an SSH agent, or a deploy key — and retry; the server has no mechanism for supplying credentials and deliberately does not want one.

## A pull or push refused before doing anything

`ff_only and rebase are mutually exclusive — pick one` means both were requested. `ff_only` defaults to `true`, so asking for `rebase: true` without also setting `ff_only: false` produces this. It is refused rather than silently resolved because the two produce genuinely different history.

`cannot pull on a detached HEAD without an explicit branch argument` and the matching push message mean the repository is not on a branch, so there is nothing to infer. Supply the branch explicitly, or check out a branch first. An audit reports a detached repository as `detached@<short-sha>`, which is the early warning.

A pull that aborts complaining about divergence is `--ff-only` working: the upstream has moved in a way that would need a merge commit. Decide deliberately between rebasing and merging rather than reaching for `force`.

## A remote name or URL was rejected

Remote names, branch names, and URLs are validated against tight patterns that reject anything beginning with `-`, any `..` sequence, and control characters. The `-` rule is an option-injection guard: a remote named `--upload-pack=…` would otherwise become an argument to `git` rather than a value. A legitimate name that trips this is rare; if you have one, the rule is still right and the name is worth changing.

## The audit log is empty or missing

`MCP_GIT_AUDIT_AUDIT_LOG` defaults to `writes`, which records mutating calls only — so on a default read-only install there is nothing to record and the file is never created. Set it to `all` to record reads as well.

If it is still empty at `all`, remember that log-write failures are swallowed to stderr on purpose, so that a broken log can never prevent a tool call from completing. Check that the directory of `MCP_GIT_AUDIT_AUDIT_LOG_PATH` is writable by the user your client runs as, and check the client's stderr log.

## Something else

If the behaviour you are seeing is not covered here and is not obviously one of these safeguards, it is worth raising — open an issue with the tool name, the arguments, and the error text. [`SECURITY.md`](../../../SECURITY.md) covers how to report anything with a security dimension privately instead.
