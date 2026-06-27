// Generated on 2026-06-27T20:39:33.273Z by @knowledgeislands/mcp-git-audit@1.0.0
// Server: kit-mcp-git-audit
// Source: /Users/krisbrown/.mcporter/mcporter.json
// Transport: STDIO /Users/krisbrown/.local/share/mise/installs/node/lts/bin/node /Users/krisbrown/kis/knowledgeislands/mcp-git-audit/dist/mcp-server/index.js

import type { CallResult } from 'mcporter'

export interface KitMcpGitAuditTools {
  /**
   * Walk a directory tree for .git directories and return repo metadata. Cheap and side-effect-free — no
   * `git` invocations. The output is intended to be cached and fed into `git_repos_audit` one or more
   * times.
   * Args:
   * - root (string, optional): Absolute or ~/... path inside one of MCP_GIT_AUDIT_SAFE_ROOTS. Omit to
   * use the single configured safe root.
   * - max_depth (number): Max depth from `root` at which a repo dir may live. Default 2.
   * Returns:
   * JSON object: { root, scanned_at, repos: [{ path, abs_path, group, name }] }.
   * Errors:
   * - "root \"X\" is not inside any configured safe_root (...)" when the root escapes safe_roots.
   * - "root must be an absolute path or start with ~/" for relative roots.
   * - "root is required when multiple safe_roots are configured" when omitted with multiple safe_roots.
   *
   * @param root? Absolute or ~-expanded path to walk. Must be inside one of MCP_GIT_AUDIT_SAFE_ROOTS.
   *              Omit when exactly one safe root is configured.
   * @param max_depth? Maximum depth (from `root`) at which a repo directory may live. Default 2.
   */
  git_repos_scan(root?: string, max_depth?: number): Promise<object>

  /**
   * Run per-repo `git` checks (branch, working-tree status, ahead/behind, last commit) over a scan
   * result. Designed to be called repeatedly against the same cached scan output — the cheap filesystem
   * walk happens once, the more expensive git work can be re-run on demand.
   * Every `abs_path` in the supplied scan is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any
   * `git` call. A path that escapes every safe root is rejected — the cache cannot be used to widen the
   * security boundary.
   * Args:
   * - scan (object): a prior result from the `git_repos_scan` tool: { root, scanned_at, repos: [{ path,
   * abs_path, group, name }] }.
   * - include_stale_days (number): Reserved; currently unused. Default 30.
   * Returns:
   * JSON object: { root, scanned_at, audited_at, repos: [...], errors?: [...] } where each repo entry
   * includes path, group, name, branch, detached, sha, subject, rel_date, iso_date, modified, untracked,
   * has_remote, has_upstream, ahead, behind.
   * Per-repo failures (e.g. corrupt .git/HEAD) are aggregated into the `errors` array rather than
   * failing the whole call.
   *
   * @param scan A previous scan result. Every repo `abs_path` is revalidated against
   *             MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call is made.
   * @param include_stale_days? Reserved — currently unused; the consumer computes stale itself.
   */
  git_repos_audit(scan: Record<string, unknown>, include_stale_days?: number): Promise<object>

  /**
   * Return commit history and working-tree status for a single repo identified by an absolute path from
   * a prior `git_repos_scan`/`git_repos_audit` result. Read-only and cheap — no fetch, no diff content,
   * no cross-repo work.
   * `abs_path` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call; the cache cannot
   * widen the security boundary.
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside one of MCP_GIT_AUDIT_SAFE_ROOTS.
   * - commits (number): Recent commits to return (newest first). Default 10, max 50.
   * - include_diffstat (boolean): When true, include per-commit `diffstat[]` from `git log --numstat`.
   * Default false. `files` count is always returned.
   * Returns:
   * JSON object: { abs_path, path, fetched_at, commits: [{ sha, subject, author, iso_date, rel_date,
   * files, diffstat? }], working_tree: { modified: [{ status, path }], summary: { modified, untracked }
   * }, error? } where each `modified[]` entry's `status` is the raw two-character `git status
   * --porcelain` code.
   * Status codes mirror `git status --porcelain` verbatim so downstream consumers other than the Cowork
   * artifact can interpret them precisely. Errors (timeout, unborn HEAD on a fresh repo with no commits)
   * surface as a `commits: []` result with an `error` field rather than throwing.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   * @param commits? How many recent commits to return (newest first). Hard cap 50.
   * @param include_diffstat? When true, include per-commit `diffstat[]` (added/removed/path) from `git
   *                          log --numstat`. Slightly slower; `files` count is always returned.
   */
  git_repo_detail(abs_path: string, commits?: number, include_diffstat?: boolean): Promise<object>

  /**
   * Run `git fetch`. Updates remote-tracking refs and FETCH_HEAD but does NOT modify the working tree or
   * local branches. Network I/O — bounded by a 60s timeout, with interactive credential prompts disabled
   * (`GIT_TERMINAL_PROMPT=0`) so an auth-required remote fails fast instead of stalling.
   * Required access level: `write` or higher (MCP_GIT_AUDIT_ACCESS_LEVEL).
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
   * - remote (string): Remote to fetch (default "origin"). Ignored when `all_remotes=true`.
   * - prune (boolean): Pass `--prune`. Default false.
   * - tags (boolean): Pass `--tags`. Default false.
   * - all_remotes (boolean): Pass `--all` (overrides `remote`). Default false.
   * - dry_run (boolean): Pass `--dry-run` (default false).
   * Returns:
   * JSON object: { abs_path, ran_at, dry_run, remote, prune, tags, all_remotes, command, stdout, stderr
   * }. Most useful output (refs updated) is on `stderr` — that's where git writes it.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   * @param remote? Remote to fetch from. Ignored when `all_remotes=true`.
   * @param prune? Pass `--prune` to drop remote-tracking refs whose upstream branches have been deleted.
   * @param tags? Pass `--tags` to fetch all tags, not just those reachable from fetched commits.
   * @param all_remotes? Pass `--all` to fetch every configured remote. Overrides `remote`.
   * @param dry_run? Pass `--dry-run` to git itself — connects to the remote but does not update local
   *                 refs.
   */
  git_repo_fetch(abs_path: string, remote?: string, prune?: boolean, tags?: boolean, all_remotes?: boolean): Promise<object>
  // optional (1): dry_run

  /**
   * Run `git pull`. Destructive — updates the working tree and the current branch. Defaults to the
   * safest shape: `ff_only=true` (abort on divergence) and `rebase=false` (no history rewrite). Pass
   * `rebase=true` explicitly to rewrite local commits. `ff_only` and `rebase` are mutually exclusive.
   * `dry_run=true` (the default) approximates a preview by running `git fetch --dry-run` against the
   * same remote/branch — git pull itself has no native dry-run.
   * Required access level: `destructive` (MCP_GIT_AUDIT_ACCESS_LEVEL).
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
   * - remote (string): Remote to pull from (default "origin").
   * - branch (string): Branch to pull. Defaults to the repo's current branch; required when HEAD is
   * detached.
   * - rebase (boolean): Pass `--rebase`. Default false. Mutually exclusive with `ff_only`.
   * - ff_only (boolean): Pass `--ff-only`. Default true.
   * - autostash (boolean): Pass `--autostash`. Default false.
   * - dry_run (boolean): When true (default), runs `git fetch --dry-run` instead of pulling.
   * Returns:
   * JSON object: { abs_path, ran_at, dry_run, remote, branch, rebase, ff_only, autostash, command,
   * stdout, stderr }.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   * @param remote? Remote to pull from.
   * @param branch? Branch to pull. Defaults to the repo's current branch. Required when HEAD is
   *                detached.
   * @param rebase? Pass `--rebase` to rebase local commits onto the upstream instead of merging.
   *                Rewrites history — opt in explicitly.
   * @param ff_only? Pass `--ff-only` (default true). Aborts with a clear error when the upstream has
   *                 diverged, instead of producing a merge commit.
   * @param autostash? Pass `--autostash` to stash uncommitted changes for the duration of the pull and
   *                   re-apply afterwards.
   * @param dry_run? When true (default), the call runs `git fetch --dry-run` against the same
   *                 remote/branch instead of pulling — git pull has no native dry-run.
   */
  git_repo_pull(abs_path: string, remote?: string, branch?: string, rebase?: boolean, ff_only?: boolean): Promise<object>
  // optional (2): autostash, dry_run

  /**
   * Run `git push`. Destructive — updates remote refs. Defaults to the safest shape:
   * `force_mode='none'`, no `--set-upstream`, no `--tags`, no `--delete`, and `dry_run=true`. `--force`
   * is gated behind an explicit enum (`force_mode: 'none' | 'with_lease' | 'force'`) so the caller can't
   * accidentally non-FF-push by toggling a boolean.
   * Required access level: `destructive` (MCP_GIT_AUDIT_ACCESS_LEVEL).
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
   * - remote (string): Remote to push to (default "origin").
   * - branch (string): Branch to push. Defaults to the repo's current branch; required when HEAD is
   * detached.
   * - force_mode ("none" | "with_lease" | "force"): How aggressively to overwrite the remote. Default
   * "none".
   * - set_upstream (boolean): Pass `--set-upstream`. Default false.
   * - tags (boolean): Pass `--tags`. Default false.
   * - delete (boolean): Pass `--delete` to delete the branch on the remote. Default false.
   * - dry_run (boolean): Pass `--dry-run` to git itself. Default true.
   * Returns:
   * JSON object: { abs_path, ran_at, dry_run, remote, branch, force_mode, set_upstream, tags, delete,
   * command, stdout, stderr }.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   * @param remote? Remote to push to.
   * @param branch? Branch to push. Defaults to the repo's current branch. Required when HEAD is
   *                detached.
   * @param force_mode? `none` (default): no force flag. `with_lease`: `--force-with-lease` (safer).
   *                    `force`: `--force` (overwrites remote unconditionally — destructive).
   * @param set_upstream? Pass `--set-upstream` to record the remote/branch as the upstream for future
   *                      pulls.
   * @param tags? Pass `--tags` to push all tags reachable from the pushed refs.
   * @param delete? Pass `--delete` to delete the branch on the remote. Destructive.
   * @param dry_run? Pass `--dry-run` to git itself — negotiates with the remote but does not update any
   *                 refs.
   */
  git_repo_push(
    abs_path: string,
    remote?: string,
    branch?: string,
    force_mode?: 'none' | 'with_lease' | 'force',
    set_upstream?: boolean
  ): Promise<object>
  // optional (3): tags, delete, dry_run

  /**
   * Return the configured fetch/push URLs of every remote in the repo. Read-only — no network, no
   * mutation.
   * `abs_path` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call; the cache cannot
   * widen the security boundary.
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside one of MCP_GIT_AUDIT_SAFE_ROOTS.
   * Returns:
   * JSON object: { abs_path, fetched_at, remotes: [{ name, fetch_url, push_url }] }. `push_url` equals
   * `fetch_url` unless an override was set with `set-url --push`.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   */
  git_repo_remotes_list(abs_path: string): Promise<object>

  /**
   * Update the fetch or push URL of an existing remote. Idempotent: running twice with the same args
   * produces the same end state. The remote must already exist — use `git_repo_remote_add` to create new
   * remotes.
   * Required access level: `write` or higher (MCP_GIT_AUDIT_ACCESS_LEVEL).
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
   * - remote (string): Name of an existing remote (e.g. "origin"). Pattern [A-Za-z0-9_.-], not starting
   * with "-" or ".".
   * - url (string): New URL. Must not start with "-" (option-injection guard); whitespace and control
   * chars are rejected.
   * - push (boolean): When true, update only the push URL. Default false.
   * - dry_run (boolean): When true (default), no mutation; the call returns the current remote entry as
   * `before` for inspection.
   * Returns:
   * JSON object: { abs_path, changed_at, dry_run, remote, before, after?, stderr }. `after` is omitted
   * when `dry_run=true`.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   * @param remote Existing remote name (e.g. "origin").
   * @param url New URL for the remote. Validated against an option-injection regex; transport semantics
   *            are left to git.
   * @param push? When true, update only the push URL (`git remote set-url --push`). Default false
   *              (update fetch URL).
   * @param dry_run? When true (default), no git mutation is performed; the call returns the current
   *                 remote entry as `before`.
   */
  git_repo_remote_set_url(abs_path: string, remote: string, url: string, push?: boolean, dry_run?: boolean): Promise<object>

  /**
   * Create a new remote with the given name and URL. Non-idempotent: a second call with the same remote
   * name fails. Use `git_repo_remote_set_url` to change an existing remote's URL.
   * Required access level: `write` or higher (MCP_GIT_AUDIT_ACCESS_LEVEL).
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
   * - remote (string): New remote name (must not already exist). Pattern [A-Za-z0-9_.-], not starting
   * with "-" or ".".
   * - url (string): URL for the new remote. Must not start with "-"; whitespace and control chars are
   * rejected.
   * - dry_run (boolean): When true (default), no mutation.
   * Returns:
   * JSON object: { abs_path, changed_at, dry_run, remote, after?, stderr }. `after` is omitted when
   * `dry_run=true`.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   * @param remote New remote name (must not already exist).
   * @param url URL for the new remote. Validated against an option-injection regex; transport semantics
   *            are left to git.
   * @param dry_run? When true (default), no git mutation is performed.
   */
  git_repo_remote_add(abs_path: string, remote: string, url: string, dry_run?: boolean): Promise<object>

  /**
   * Drop a remote's config and any `refs/remotes/<name>/*` tracking refs. Working-tree files are
   * untouched. Idempotent end state: gone is gone.
   * Required access level: `destructive` (MCP_GIT_AUDIT_ACCESS_LEVEL).
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
   * - remote (string): Name of the remote to remove.
   * - dry_run (boolean): When true (default), no mutation; the call returns the current remote entry as
   * `before` for inspection.
   * Returns:
   * JSON object: { abs_path, changed_at, dry_run, remote, before, stderr }.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   * @param remote Existing remote name to remove.
   * @param dry_run? When true (default), no git mutation is performed; the call returns the current
   *                 remote entry as `before`.
   */
  git_repo_remote_remove(abs_path: string, remote: string, dry_run?: boolean): Promise<object>

  /**
   * Return structured diff data for the working tree or the index. Read-only — no network, no mutation.
   * Internally runs three `git diff` invocations (`--numstat -z`, `--name-status -z`, and unified patch)
   * so each file entry can carry counts, a status letter, and the patch body without re-implementing
   * rename-aware path parsing on top of an interleaved `-p --numstat` stream.
   * `abs_path` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call; a cached scan
   * cannot widen the security boundary. Any `paths` entry must be repo-relative — leading `-` / `/` and
   * `..` segments are rejected.
   * `max_lines` is a budget across all files. Once a file's diff would push the running total over the
   * cap, that file's `diff` becomes `null` and its `truncated` flag is set; subsequent files are
   * likewise null+truncated. The top-level `truncated` is the disjunction over file entries.
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
   * - staged (boolean): `false` (default) for unstaged diff, `true` for `--cached`.
   * - paths (string[]): Optional repo-relative pathspec to narrow the diff.
   * - max_lines (integer): Total diff body line cap. Default 500, max 2000.
   * Returns:
   * JSON object: { abs_path, staged, fetched_at, total_additions, total_deletions, truncated, files: [{
   * path, status, additions, deletions, diff, truncated }] }.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   * @param staged? `false` (default) → `git diff` (unstaged). `true` → `git diff --cached` (staged).
   * @param paths? Limit the diff to these repo-relative paths. When omitted, returns every changed file.
   * @param max_lines? Cap on total diff body lines across all files. When a file's diff would exceed the
   *                   remaining budget, its `diff` is set to null and the file's `truncated` flag is
   *                   true. Max 2000.
   */
  git_repo_diff(abs_path: string, staged?: boolean, paths?: string[], max_lines?: number): Promise<object>

  /**
   * Stage a set of files and create a commit. Destructive — writes a commit object and moves HEAD when
   * `dry_run=false`. Handles the full add → commit lifecycle in one call so the artifact's "preview →
   * confirm" loop reduces to two MCP calls.
   * `dry_run=true` (the default) runs the staging step normally but invokes `git commit --dry-run` — git
   * prints what would be committed without writing an object or moving HEAD. The index mutation done by
   * the staging step is local-only state and is fully reversible with `git reset`; treating it as part
   * of the preview is intentional, because the artifact preview needs to reflect the post-stage state.
   * `abs_path` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call. `paths` entries
   * (only allowed when `stage="paths"`) must be repo-relative — leading `-` / `/` and `..` segments are
   * rejected as an option-injection guard.
   * No `--amend` in v1. Amending rewrites history and complicates the push flow (would need
   * force-with-lease). Adding it later requires an explicit `amend: true` flag with its own warning
   * copy.
   * Required access level: `destructive` (MCP_GIT_AUDIT_ACCESS_LEVEL).
   * Args:
   * - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
   * - message (string): Commit message. Single-line in v1.
   * - stage ("all_tracked" | "all" | "paths" | "none"): What to stage before committing. Default
   * "all_tracked".
   * - paths (string[]): Required when `stage="paths"`, rejected otherwise. Repo-relative paths.
   * - dry_run (boolean): Pass `--dry-run` to git commit. Default true.
   * - allow_empty (boolean): Pass `--allow-empty`. Default false.
   * Returns:
   * JSON object: { abs_path, ran_at, dry_run, stage, staged_paths, message, command, sha, stdout, stderr
   * }. `sha` is the short SHA of the new HEAD, or `null` on dry-run.
   *
   * @param abs_path Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit`
   *                 result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.
   * @param message Commit message. Single-line in v1 (no multi-line messages — no `\n` support).
   * @param stage? What to stage before committing. `all_tracked` → `git add -u`. `all` → `git add -A`.
   *               `paths` → `git add -- <paths>` (requires `paths`). `none` → commit the index as-is.
   * @param paths? Required when `stage === "paths"`, rejected otherwise. Repo-relative file paths.
   * @param dry_run? When true (default), runs `git commit --dry-run` — shows what would be committed
   *                 without writing an object or moving HEAD. The staging step still runs because the
   *                 index is local, fully reversible state and the preview needs to reflect it.
   * @param allow_empty? Pass `--allow-empty`. Default false — empty commits are almost always a mistake.
   */
  git_repo_commit(
    abs_path: string,
    message: string,
    stage?: 'all_tracked' | 'all' | 'paths' | 'none',
    paths?: string[],
    dry_run?: boolean
  ): Promise<object>
  // optional (1): allow_empty
}
