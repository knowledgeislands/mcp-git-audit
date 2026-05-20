import { SAFE_ROOTS } from './config.js'
import { GIT_LOCAL_TIMEOUT_MS, runGitCapture } from './utils/git-exec.js'
import { resolveAgainstSafeRoots } from './utils/paths.js'

export interface RemoteEntry {
  name: string
  fetch_url: string
  push_url: string
}

export interface ListRemotesResult {
  abs_path: string
  fetched_at: string
  remotes: RemoteEntry[]
}

export interface MutateRemoteResult {
  abs_path: string
  changed_at: string
  dry_run: boolean
  remote: string
  before?: RemoteEntry
  after?: RemoteEntry
  stderr: string
}

const parseRemoteVerbose = (stdout: string): RemoteEntry[] => {
  // `git remote -v` lines look like:
  //   origin\thttps://github.com/foo/bar.git (fetch)
  //   origin\thttps://github.com/foo/bar.git (push)
  const byName: Map<string, { fetch_url: string; push_url: string }> = new Map()
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const m = /^(\S+)\t(.+?)\s+\((fetch|push)\)$/.exec(line)
    /* v8 ignore next -- `git remote -v` always emits lines matching this format; defensive skip. */
    if (!m) continue
    const [, name, url, kind] = m as unknown as [string, string, string, 'fetch' | 'push']
    const existing = byName.get(name) ?? { fetch_url: '', push_url: '' }
    if (kind === 'fetch') existing.fetch_url = url
    else existing.push_url = url
    byName.set(name, existing)
  }
  return Array.from(byName.entries())
    .map(([name, urls]) => ({ name, ...urls }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const findRemote = (entries: RemoteEntry[], name: string): RemoteEntry | undefined => entries.find((r) => r.name === name)

const readRemotes = async (resolvedRepo: string): Promise<RemoteEntry[]> => {
  const { stdout } = await runGitCapture(resolvedRepo, ['remote', '-v'], GIT_LOCAL_TIMEOUT_MS)
  return parseRemoteVerbose(stdout)
}

/**
 * List configured remotes for a repo. Read-only — no network, no mutation.
 * `abs_path` is revalidated against SAFE_ROOTS as defence in depth.
 */
export const listRemotes = async (absPath: string): Promise<ListRemotesResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, SAFE_ROOTS)
  const fetched_at = new Date().toISOString()
  const remotes = await readRemotes(resolved)
  return { abs_path: resolved, fetched_at, remotes }
}

export interface SetUrlOptions {
  remote: string
  url: string
  push: boolean
  dry_run: boolean
}

/**
 * Change the URL of an existing remote. `push=true` updates only the push
 * URL (`git remote set-url --push`); otherwise updates the fetch URL.
 * Idempotent: running twice with the same args produces the same end state.
 */
export const setRemoteUrl = async (absPath: string, opts: SetUrlOptions): Promise<MutateRemoteResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, SAFE_ROOTS)
  const before = findRemote(await readRemotes(resolved), opts.remote)
  if (!before) {
    throw new Error(`remote "${opts.remote}" does not exist; use git_repo_remote_add to create it`)
  }
  const changed_at = new Date().toISOString()
  if (opts.dry_run) {
    return { abs_path: resolved, changed_at, dry_run: true, remote: opts.remote, before, stderr: '' }
  }
  const args = ['remote', 'set-url']
  if (opts.push) args.push('--push')
  args.push(opts.remote, opts.url)
  const { stderr } = await runGitCapture(resolved, args, GIT_LOCAL_TIMEOUT_MS)
  const after = findRemote(await readRemotes(resolved), opts.remote)
  return { abs_path: resolved, changed_at, dry_run: false, remote: opts.remote, before, after, stderr }
}

export interface AddRemoteOptions {
  remote: string
  url: string
  dry_run: boolean
}

/**
 * Add a new remote. Non-idempotent: the second call fails because the remote
 * already exists. Fetches no objects.
 */
export const addRemote = async (absPath: string, opts: AddRemoteOptions): Promise<MutateRemoteResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, SAFE_ROOTS)
  const existing = findRemote(await readRemotes(resolved), opts.remote)
  if (existing) {
    throw new Error(`remote "${opts.remote}" already exists (fetch=${existing.fetch_url}); use git_repo_remote_set_url to change its URL`)
  }
  const changed_at = new Date().toISOString()
  if (opts.dry_run) {
    return { abs_path: resolved, changed_at, dry_run: true, remote: opts.remote, stderr: '' }
  }
  const { stderr } = await runGitCapture(resolved, ['remote', 'add', opts.remote, opts.url], GIT_LOCAL_TIMEOUT_MS)
  const after = findRemote(await readRemotes(resolved), opts.remote)
  return { abs_path: resolved, changed_at, dry_run: false, remote: opts.remote, after, stderr }
}

export interface RemoveRemoteOptions {
  remote: string
  dry_run: boolean
}

/**
 * Remove an existing remote. Destructive — drops the remote config and any
 * remote-tracking refs (`refs/remotes/<name>/*`). Working-tree files are
 * untouched. Idempotent end state: gone is gone.
 */
export const removeRemote = async (absPath: string, opts: RemoveRemoteOptions): Promise<MutateRemoteResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, SAFE_ROOTS)
  const before = findRemote(await readRemotes(resolved), opts.remote)
  if (!before) {
    throw new Error(`remote "${opts.remote}" does not exist`)
  }
  const changed_at = new Date().toISOString()
  if (opts.dry_run) {
    return { abs_path: resolved, changed_at, dry_run: true, remote: opts.remote, before, stderr: '' }
  }
  const { stderr } = await runGitCapture(resolved, ['remote', 'remove', opts.remote], GIT_LOCAL_TIMEOUT_MS)
  return { abs_path: resolved, changed_at, dry_run: false, remote: opts.remote, before, stderr }
}
