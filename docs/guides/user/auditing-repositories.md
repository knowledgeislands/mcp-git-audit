# Auditing repositories

Find out what a tree of repositories looks like — which are dirty, which are behind their upstream, which have no remote at all — and then look closely at any one of them. Everything here works at the default `read` access level.

## The shape of the work

The read-only surface is six tools built around two stages, and the split is the thing worth understanding before you start.

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

## Auditing several roots at once

`git_repos_audit_roots` scans and audits up to 16 roots in one read-only call and returns one result per root, in the order you asked for them. Each root is scanned as `git_repos_scan` would scan it and its repositories are audited as `git_repos_audit` would audit them, so repository entries, `errors[]`, stashes and submodules look exactly as described above. There is no cached scan to hand back; use the two-step tools when you want to re-audit the same walk.

Every root is checked against `MCP_GIT_AUDIT_SAFE_ROOTS` before any root is walked. A relative root, or one that escapes the safe roots directly or through a symlink, rejects the whole request and nothing is read; the error names the offending position, such as `roots[1]`. Once the request is accepted, one root's trouble never fails another's.

`max_depth` (default 2, at most 8) applies to every root. `limit` (default 100, at most 1000) caps the repositories audited across the whole request, not per root: roots are processed in order, each is scanned in full, and its repositories are taken in scan order - group, then name - until the budget runs out. Only the repositories taken run `git`; `omitted` counts the ones found but not taken. The limit bounds the size of the answer and the Git work, not elapsed time or how much of the filesystem a scan visits.

Each result carries `requested` (as you wrote it) and `root` (its canonical, symlink-resolved path), plus a `status`:

- `ok` - every repository found was audited without error, including a root that holds no repositories.
- `partial` - some repositories failed and appear in `errors[]`, or `omitted` is above zero because the limit was reached.
- `error` - the root does not exist or is not a directory. `scanned_at` and `audited_at` are `null`, and `errors[]` holds one entry naming the root.

`audited_at` is also `null` when a root was scanned but none of its repositories were audited, because it was empty or the budget was already spent.

Two roots that resolve to the same directory - `~/work` and `/Users/you/work`, say, or a symlink and its target - are audited once, at the first position, and each later spelling is listed in `duplicate_roots` with the index of the result that covers it. Roots that overlap without being identical, such as `~/work` and `~/work/clients`, stay separate results and may report the same repository twice; each appearance counts towards `limit`.

```json
{
  "requested_at": "2026-10-04T09:00:00.000Z",
  "limit": 4,
  "max_depth": 2,
  "roots": [
    { "requested": "~/work", "root": "/Users/you/work", "status": "ok", "scanned_at": "...", "audited_at": "...", "repos": ["... 3 repositories ..."], "errors": [], "omitted": 0 },
    { "requested": "~/oss", "root": "/Users/you/oss", "status": "partial", "scanned_at": "...", "audited_at": "...", "repos": ["... 1 repository ..."], "errors": [], "omitted": 2 },
    { "requested": "~/gone", "root": "/Users/you/gone", "status": "error", "scanned_at": null, "audited_at": null, "repos": [], "errors": [{ "path": "/Users/you/gone", "message": "root is not accessible: ..." }], "omitted": 0 }
  ],
  "duplicate_roots": [{ "requested": "/Users/you/work", "canonical": "/Users/you/work", "duplicate_of_index": 0 }]
}
```

## Stashes and submodules

Two kinds of work escape the modified and untracked counts, so each audited repository also carries a `stash` and a `submodules` summary.

`stash` reports how many stash entries the repository retains: `{ status: "available", count }`. Stash subjects are never read or returned, because they often carry the very notes a caller should not see. If `git stash list` fails, the summary is `{ status: "unavailable", count: null, error }` — an unknown is never reported as zero.

`submodules` lists the repository's first-level gitlinks, read from its index. `total` counts them, at most 100 `entries` are returned in path order, and `omitted` counts the rest. Each entry gives the literal repository-relative `path`, the `expected_commit` recorded by the parent, the `actual_commit` checked out in the child (or `null`), a `state` and a `dirty` flag:

- `uninitialised` — the child has no `.git` entry (never cloned or deinitialised); `actual_commit` and `dirty` are `null`.
- `matched` or `changed` — the child's HEAD equals or differs from the expected commit; `dirty` says whether the child has working-tree changes, or is `null` when that could not be read.
- `unavailable` — the child could not be inspected safely: its Git metadata is unsupported or lies outside the safe roots, its HEAD cannot be read, or the gitlink is mid-conflict.

The audit never fetches, initialises or recurses into submodules: a submodule's own submodules are not listed, and `git` runs inside a child only after its metadata has passed the same authorisation as any other repository (see [Linked worktrees and pointer files](#linked-worktrees-and-pointer-files)). Because of that, the parent's modified count ignores submodules; a moved or dirty submodule shows up in `submodules`, not in `modified`. If the index cannot be listed, the summary is `unavailable` with `total`, `omitted` and the entries left empty or `null`.

## Looking at one repository

Once the audit has named something interesting, three tools work on a single repository, each taking the absolute path from the earlier result. That path is re-validated against the safe roots before anything runs: a scan result cannot be edited to reach somewhere the server was never allowed to go. `git_repo_detail` also authorises the repository's Git metadata, as described under [Linked worktrees and pointer files](#linked-worktrees-and-pointer-files), and fails rather than reading unauthorised metadata.

`git_repo_detail` returns recent commit history and the working-tree file listing. It defaults to 10 commits and will not return more than 50. Asking for a diffstat adds per-commit added/removed/path entries, computed from `git log --numstat`; the count of files touched is always there regardless. This tool degrades rather than throws: if the metadata read times out or `git` fails, the history and working tree still come back, with an `error` field explaining what went missing. A repository with no commits yet returns an empty commit list and no error, which is the correct answer rather than a failure.

`git_repo_diff` returns a structured diff — one entry per changed file with its status, added and removed line counts, and the unified patch body. Ask for the staged diff or the unstaged one; unstaged is the default. A pathspec narrows it to particular files, and leading `-` or `/` and `..` segments in that pathspec are rejected.

Its `max_lines` parameter is the part that surprises people: it is a budget across the whole diff, not a per-file cap. It defaults to 500 and will not exceed 2000. Once one file's patch would push the running total over the budget, that file comes back with a null patch body and a `truncated` flag, and so does every file after it — the counts and statuses remain, only the patch bodies stop. When you see truncation, narrowing by pathspec is a better move than raising the budget, because it puts the lines you care about at the front.

`git_repo_remotes_list` lists configured remotes with their fetch and push URLs. The two differ only where a push override was configured with `git remote set-url --push`, so a difference is itself worth noticing.

## When it is slow

Local `git` calls are bounded at eight seconds, and the metadata read behind `git_repo_detail` at six. Nothing waits longer than that, so a huge repository or a contended filesystem shows up as a timed-out entry rather than a hung conversation. [Troubleshooting](troubleshooting.md) covers what to do about one.
