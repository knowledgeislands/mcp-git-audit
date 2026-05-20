import { SAFE_ROOTS } from './config.js'
import { errMessage } from './utils/errors.js'
import { GIT_LOCAL_TIMEOUT_MS, GIT_NETWORK_TIMEOUT_MS, runGitCapture } from './utils/git-exec.js'
import { resolveAgainstSafeRoots } from './utils/paths.js'

interface SyncResultBase {
  abs_path: string
  ran_at: string
  dry_run: boolean
  command: string[]
  stdout: string
  stderr: string
}

export interface FetchOptions {
  remote: string
  prune: boolean
  tags: boolean
  all_remotes: boolean
  dry_run: boolean
}

export interface FetchResult extends SyncResultBase {
  remote: string
  prune: boolean
  tags: boolean
  all_remotes: boolean
}

const readCurrentBranch = async (resolvedRepo: string): Promise<{ branch: string; detached: boolean }> => {
  try {
    const { stdout } = await runGitCapture(resolvedRepo, ['symbolic-ref', '--short', '-q', 'HEAD'], GIT_LOCAL_TIMEOUT_MS)
    const branch = stdout.trim()
    /* v8 ignore next -- `symbolic-ref --short -q HEAD` either prints the branch or exits non-zero (caught below); empty stdout is defence in depth. */
    if (branch.length === 0) return { branch: '', detached: true }
    return { branch, detached: false }
  } catch {
    return { branch: '', detached: true }
  }
}

const buildFetchArgs = (opts: FetchOptions): string[] => {
  const args = ['fetch']
  if (opts.prune) args.push('--prune')
  if (opts.tags) args.push('--tags')
  if (opts.dry_run) args.push('--dry-run')
  if (opts.all_remotes) {
    args.push('--all')
  } else {
    args.push('--', opts.remote)
  }
  return args
}

/**
 * Run `git fetch`. Network I/O; bounded by GIT_NETWORK_TIMEOUT_MS.
 * `--dry-run` is passed to git itself when `opts.dry_run` is set — git connects
 * to the remote but doesn't update local refs, so the user gets a real preview
 * of what would change.
 */
export const fetchRepo = async (absPath: string, opts: FetchOptions): Promise<FetchResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, SAFE_ROOTS)
  const ran_at = new Date().toISOString()
  const args = buildFetchArgs(opts)
  try {
    const { stdout, stderr } = await runGitCapture(resolved, args, GIT_NETWORK_TIMEOUT_MS)
    return {
      abs_path: resolved,
      ran_at,
      dry_run: opts.dry_run,
      remote: opts.remote,
      prune: opts.prune,
      tags: opts.tags,
      all_remotes: opts.all_remotes,
      command: ['git', ...args],
      stdout,
      stderr
    }
  } catch (err) {
    throw new Error(`git fetch failed: ${errMessage(err)}`)
  }
}

export interface PullOptions {
  remote: string
  branch?: string
  rebase: boolean
  ff_only: boolean
  autostash: boolean
  dry_run: boolean
}

export interface PullResult extends SyncResultBase {
  remote: string
  branch: string
  rebase: boolean
  ff_only: boolean
  autostash: boolean
}

const buildPullArgs = (opts: Omit<PullOptions, 'branch'> & { branch: string }): string[] => {
  const args = ['pull']
  if (opts.ff_only) args.push('--ff-only')
  if (opts.rebase) args.push('--rebase')
  if (opts.autostash) args.push('--autostash')
  args.push('--', opts.remote, opts.branch)
  return args
}

/**
 * Run `git pull`. Destructive — updates the working tree and current branch.
 * Defaults err on the side of safety: `ff_only=true` by default, so a divergent
 * upstream aborts cleanly instead of producing a merge commit. `rebase=true`
 * rewrites local commits; the schema requires the caller to opt in.
 *
 * `dry_run=true` only fetches (no merge/rebase) — git pull doesn't support a
 * native dry-run, so we approximate it by running `git fetch` instead.
 */
export const pullRepo = async (absPath: string, opts: PullOptions): Promise<PullResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, SAFE_ROOTS)
  const ran_at = new Date().toISOString()
  if (opts.ff_only && opts.rebase) {
    throw new Error('ff_only and rebase are mutually exclusive — pick one')
  }
  const { branch: currentBranch, detached } = await readCurrentBranch(resolved)
  if (detached && opts.branch === undefined) {
    throw new Error('cannot pull on a detached HEAD without an explicit branch argument')
  }
  const branch = opts.branch ?? currentBranch

  if (opts.dry_run) {
    const fetchArgs = ['fetch', '--dry-run', '--', opts.remote, branch]
    try {
      const { stdout, stderr } = await runGitCapture(resolved, fetchArgs, GIT_NETWORK_TIMEOUT_MS)
      return {
        abs_path: resolved,
        ran_at,
        dry_run: true,
        remote: opts.remote,
        branch,
        rebase: opts.rebase,
        ff_only: opts.ff_only,
        autostash: opts.autostash,
        command: ['git', ...fetchArgs],
        stdout,
        stderr
      }
    } catch (err) {
      throw new Error(`git pull dry-run (via fetch --dry-run) failed: ${errMessage(err)}`)
    }
  }

  const args = buildPullArgs({ ...opts, branch })
  try {
    const { stdout, stderr } = await runGitCapture(resolved, args, GIT_NETWORK_TIMEOUT_MS)
    return {
      abs_path: resolved,
      ran_at,
      dry_run: false,
      remote: opts.remote,
      branch,
      rebase: opts.rebase,
      ff_only: opts.ff_only,
      autostash: opts.autostash,
      command: ['git', ...args],
      stdout,
      stderr
    }
  } catch (err) {
    throw new Error(`git pull failed: ${errMessage(err)}`)
  }
}

export type PushForceMode = 'none' | 'with_lease' | 'force'

export interface PushOptions {
  remote: string
  branch?: string
  force_mode: PushForceMode
  set_upstream: boolean
  tags: boolean
  delete: boolean
  dry_run: boolean
}

export interface PushResult extends SyncResultBase {
  remote: string
  branch: string
  force_mode: PushForceMode
  set_upstream: boolean
  tags: boolean
  delete: boolean
}

const buildPushArgs = (opts: PushOptions & { branch: string }): string[] => {
  const args = ['push']
  if (opts.dry_run) args.push('--dry-run')
  if (opts.force_mode === 'with_lease') args.push('--force-with-lease')
  else if (opts.force_mode === 'force') args.push('--force')
  if (opts.set_upstream) args.push('--set-upstream')
  if (opts.tags) args.push('--tags')
  if (opts.delete) args.push('--delete')
  args.push('--', opts.remote, opts.branch)
  return args
}

/**
 * Run `git push`. Destructive — updates remote refs. Defaults to the safest
 * shape: `force_mode='none'`, no upstream change, no tag push. `--force` is
 * gated behind an explicit `force_mode` enum so the caller can't accidentally
 * trigger a non-FF push by passing a boolean.
 *
 * `dry_run=true` is passed through to git itself (`git push --dry-run`); git
 * negotiates with the remote but doesn't update any refs.
 */
export const pushRepo = async (absPath: string, opts: PushOptions): Promise<PushResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, SAFE_ROOTS)
  const ran_at = new Date().toISOString()
  const { branch: currentBranch, detached } = await readCurrentBranch(resolved)
  if (detached && opts.branch === undefined) {
    throw new Error('cannot push on a detached HEAD without an explicit branch argument')
  }
  const branch = opts.branch ?? currentBranch
  const args = buildPushArgs({ ...opts, branch })
  try {
    const { stdout, stderr } = await runGitCapture(resolved, args, GIT_NETWORK_TIMEOUT_MS)
    return {
      abs_path: resolved,
      ran_at,
      dry_run: opts.dry_run,
      remote: opts.remote,
      branch,
      force_mode: opts.force_mode,
      set_upstream: opts.set_upstream,
      tags: opts.tags,
      delete: opts.delete,
      command: ['git', ...args],
      stdout,
      stderr
    }
  } catch (err) {
    throw new Error(`git push failed: ${errMessage(err)}`)
  }
}
