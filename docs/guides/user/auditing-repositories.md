# Auditing repositories

Find out what a tree of repositories looks like — which are dirty, which are behind their upstream, which have no remote at all — and then look closely at any one of them. Everything here works at the default `read` access level.

## The shape of the work

The read-only surface is five tools in two stages, and the split is the thing worth understanding before you start.

`git_repos_scan` walks the filesystem and finds repositories. It runs no `git` at all. `git_repos_audit` takes the result of that walk and runs the `git` commands that produce branch, status, ahead/behind, and last-commit facts for each repository it names.

They are separate because the walk is the expensive half and the answers are the perishable half. A scan of a large tree can be handed back to the audit tool repeatedly — an hour later, or after you have committed something — without paying for the walk again. In a conversation this usually happens on its own: the model keeps the scan result and re-audits. It is worth asking for explicitly when you are iterating.

## Scanning a tree

Ask for a scan of a directory inside your safe roots. Two parameters matter.

`root` names the directory to walk. It may be omitted only when exactly one entry is configured in `MCP_GIT_AUDIT_SAFE_ROOTS`; with several configured, omitting it is an error rather than a guess.

`max_depth` bounds how deep below `root` a repository may be found, defaulting to 2 and capped at 8. The default suits the common `~/dev/<org>/<repo>` layout. Raise it when your repositories nest deeper than that, and expect the walk to cost more when you do.

The walk skips hidden directories and `node_modules` outright, so a deep `.git` inside a dependency or a cache never appears. Each repository comes back with its path relative to the root, its absolute path, its name, and a `group` — the first path segment, or `(root)` for repositories sitting directly in the root. The group is what makes "show me the state of everything under `work/`" a sensible follow-up question.

## Linked worktrees and pointer files

A directory counts as a repository when its `.git` entry is either a directory or a regular file. The file form is how Git marks a linked worktree (`git worktree add`) or a submodule checkout: it holds a single `gitdir: <path>` line naming the metadata directory, which in turn may name a shared common directory through a `commondir` file. The scan lists such directories without reading the pointer; a symlinked `.git` entry is not treated as a repository.

The server does not take a permitted working directory as permission to read wherever its pointer leads. Before any `git` command runs against a repository, the audit and detail tools resolve its `.git` entry, the `gitdir` target and any `commondir` target through symlinks, and require every one of them to lie inside `MCP_GIT_AUDIT_SAFE_ROOTS`. A worktree whose metadata lives elsewhere — a worktree of a repository outside your safe roots, or one created by a tool that keeps its checkouts in a separate cache — is unsupported: the audit reports it in `errors[]` with an `unsupported Git metadata` message and runs no `git` for it. The same message covers malformed, oversized, dangling and cyclic pointers, and a directory with no `.git` entry at all, which would otherwise let `git` borrow an enclosing repository. To audit such a worktree, add a safe root that contains its metadata as well as its working directory.

## Auditing what you found

Hand the scan result to `git_repos_audit`. For each repository it reports the current branch — or `detached@<short-sha>` when HEAD is detached — the short SHA and subject of the last commit with both an ISO and a relative date, counts of modified and untracked files, whether an `origin` remote and an upstream exist, and how far ahead or behind that upstream the branch is.

Two properties of the result are worth relying on.

**A failing repository does not fail the call.** A corrupt `.git/HEAD`, a permission problem, or a `git` invocation that times out is collected into an `errors[]` array alongside the repositories that did work. A single broken checkout in a tree of two hundred costs you one entry, not the audit. A repository whose Git metadata is unsupported or lies outside the safe roots is reported the same way, without any `git` command being run against it. Each entry carries the repository's relative `path` and a `message`.

**Ahead and behind are as fresh as your last fetch.** This tool reads refs; it does not contact a remote. A repository that looks up to date may simply not have fetched recently. Closing that gap means `git_repo_fetch`, which is a write-level tool — see [Granting write access](granting-write-access.md).

## Looking at one repository

Once the audit has named something interesting, three tools work on a single repository, each taking the absolute path from the earlier result. That path is re-validated against the safe roots before anything runs: a scan result cannot be edited to reach somewhere the server was never allowed to go. `git_repo_detail` also authorises the repository's Git metadata, as described under [Linked worktrees and pointer files](#linked-worktrees-and-pointer-files), and fails rather than reading unauthorised metadata.

`git_repo_detail` returns recent commit history and the working-tree file listing. It defaults to 10 commits and will not return more than 50. Asking for a diffstat adds per-commit added/removed/path entries, computed from `git log --numstat`; the count of files touched is always there regardless. This tool degrades rather than throws: if the metadata read times out or `git` fails, the history and working tree still come back, with an `error` field explaining what went missing. A repository with no commits yet returns an empty commit list and no error, which is the correct answer rather than a failure.

`git_repo_diff` returns a structured diff — one entry per changed file with its status, added and removed line counts, and the unified patch body. Ask for the staged diff or the unstaged one; unstaged is the default. A pathspec narrows it to particular files, and leading `-` or `/` and `..` segments in that pathspec are rejected.

Its `max_lines` parameter is the part that surprises people: it is a budget across the whole diff, not a per-file cap. It defaults to 500 and will not exceed 2000. Once one file's patch would push the running total over the budget, that file comes back with a null patch body and a `truncated` flag, and so does every file after it — the counts and statuses remain, only the patch bodies stop. When you see truncation, narrowing by pathspec is a better move than raising the budget, because it puts the lines you care about at the front.

`git_repo_remotes_list` lists configured remotes with their fetch and push URLs. The two differ only where a push override was configured with `git remote set-url --push`, so a difference is itself worth noticing.

## When it is slow

Local `git` calls are bounded at eight seconds, and the metadata read behind `git_repo_detail` at six. Nothing waits longer than that, so a huge repository or a contended filesystem shows up as a timed-out entry rather than a hung conversation. [Troubleshooting](troubleshooting.md) covers what to do about one.
