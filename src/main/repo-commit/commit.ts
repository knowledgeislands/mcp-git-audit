import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { errMessage } from '../../utils/errors.js'
import { GIT_LOCAL_TIMEOUT_MS, runGitCapture } from '../../utils/git-exec.js'
import { resolveAgainstSafeRoots } from '../../utils/paths.js'

/**
 * `paths` builds the commit from `HEAD` plus the working-tree content of the
 * named paths. `prepared_index` commits the current index as-is, but only when
 * its staged path set equals `paths` exactly.
 */
export type CommitStage = 'paths' | 'prepared_index'

export interface CommitOptions {
  message: string
  stage: CommitStage
  paths: readonly string[]
  dry_run: boolean
  allow_empty: boolean
}

export interface RejectedPath {
  path: string
  reason: string
}

export interface CommitResult {
  ok: boolean
  error: string | null
  abs_path: string
  ran_at: string
  dry_run: boolean
  stage: CommitStage
  staged_paths: string[]
  skipped_paths: string[]
  rejected_paths: RejectedPath[]
  hook_modified_paths: string[]
  message: string
  command: string
  sha: string | null
  stdout: string
  stderr: string
}

type GitEnv = Readonly<Record<string, string>>

const git = (repo: string, args: string[], env?: GitEnv) => runGitCapture(repo, args, GIT_LOCAL_TIMEOUT_MS, env)

const splitZ = (stdout: string): string[] => stdout.split('\0').filter((p) => p.length > 0)

// --- path validation ---------------------------------------------------------

/** Return why `p` is not a literal, normalised, repo-relative file path, or null when it is. */
const syntaxProblem = (p: string): string | null => {
  if (p.length === 0 || p.length > 4096) return 'must be 1-4096 characters long'
  if (/[\0\r\n]/.test(p)) return 'must not contain NUL or newline characters'
  if (p.startsWith('-')) return 'must not start with "-"'
  if (p.startsWith('/')) return 'must be repo-relative, not absolute'
  if (/[:*?[]/.test(p)) return 'must not contain pathspec magic (":", "*", "?" or "[")'
  const segments = p.split('/')
  if (segments.includes('..')) return 'must not contain ".." segments'
  if (segments.some((s) => s === '' || s === '.'))
    return 'must be normalised (no empty or "." segments, no trailing "/")'
  if (segments.some((s) => s.toLowerCase() === '.git')) return 'must not address Git metadata (".git")'
  return null
}

type WorktreeKind = 'file' | 'directory' | 'missing' | 'beyond_symlink'

const lstatOrNull = async (p: string) => {
  try {
    return await fs.lstat(p)
  } catch {
    return null
  }
}

/** Classify a repo-relative path in the working tree without following a symlinked ancestor. */
const inspectWorktreePath = async (repo: string, rel: string): Promise<WorktreeKind> => {
  let current = repo
  for (const segment of rel.split('/').slice(0, -1)) {
    current = path.join(current, segment)
    const st = await lstatOrNull(current)
    if (st === null) return 'missing'
    if (st.isSymbolicLink()) return 'beyond_symlink'
  }
  const st = await lstatOrNull(path.join(repo, rel))
  if (st === null) return 'missing'
  return st.isDirectory() ? 'directory' : 'file'
}

const listTrackedAtHead = async (repo: string, head: string | null, paths: string[]): Promise<Set<string>> => {
  if (head === null || paths.length === 0) return new Set()
  const { stdout } = await git(repo, [
    '--literal-pathspecs',
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    '--full-tree',
    head,
    '--',
    ...paths
  ])
  return new Set(splitZ(stdout))
}

// Lists the named paths that are untracked against an empty index and ignored.
// `emptyIndex` names a file that does not exist, which Git reads as empty.
const listIgnored = async (repo: string, paths: string[], emptyIndex: string): Promise<Set<string>> => {
  if (paths.length === 0) return new Set()
  const { stdout } = await git(
    repo,
    ['--literal-pathspecs', 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ...paths],
    { GIT_INDEX_FILE: emptyIndex }
  )
  return new Set(splitZ(stdout))
}

/**
 * Validate every named path before any Git write. A path must be a literal,
 * normalised, repo-relative file path that is either present in the working
 * tree or tracked at `HEAD` (a tracked deletion). Every failure is reported.
 */
const validatePaths = async (
  repo: string,
  head: string | null,
  paths: string[],
  stage: CommitStage,
  emptyIndex: string
): Promise<RejectedPath[]> => {
  const rejected: RejectedPath[] = []
  const candidates: string[] = []
  for (const p of paths) {
    const problem = syntaxProblem(p)
    if (problem === null) candidates.push(p)
    else rejected.push({ path: p, reason: problem })
  }
  const kinds = new Map<string, WorktreeKind>()
  for (const p of candidates) kinds.set(p, await inspectWorktreePath(repo, p))
  const tracked = await listTrackedAtHead(repo, head, candidates)
  const untrackedPresent = candidates.filter((p) => kinds.get(p) === 'file' && !tracked.has(p))
  // Only `paths` mode runs `git add`; a prepared index may hold a force-added path.
  const ignored = stage === 'paths' ? await listIgnored(repo, untrackedPresent, emptyIndex) : new Set<string>()
  for (const p of candidates) {
    const kind = kinds.get(p)
    if (kind === 'directory') rejected.push({ path: p, reason: 'is a directory; name individual files' })
    else if (kind === 'beyond_symlink') rejected.push({ path: p, reason: 'is beyond a symbolic link' })
    else if (kind === 'missing' && !tracked.has(p))
      rejected.push({ path: p, reason: 'is neither present in the working tree nor tracked at HEAD' })
    else if (ignored.has(p))
      rejected.push({ path: p, reason: 'is ignored and untracked; force-add it and use stage="prepared_index"' })
  }
  return rejected
}

// --- repository state ----------------------------------------------------------

const readHead = async (repo: string): Promise<string | null> => {
  try {
    return (await git(repo, ['rev-parse', '-q', '--verify', 'HEAD^{commit}'])).stdout.trim()
  } catch {
    return null
  }
}

const readParent = async (repo: string, sha: string): Promise<string | null> => {
  try {
    return (await git(repo, ['rev-parse', '-q', '--verify', `${sha}^1`])).stdout.trim()
  } catch {
    return null
  }
}

const IN_PROGRESS: readonly (readonly [string, string])[] = [
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert']
]

// `git commit` would turn a merge into a merge commit and adopt a pick's
// metadata, so a named-path commit refuses while any of them is in progress.
const readInProgressOperation = async (repo: string): Promise<string | null> => {
  for (const [ref, label] of IN_PROGRESS) {
    try {
      await git(repo, ['rev-parse', '-q', '--verify', ref])
      return label
    } catch {
      /* absent */
    }
  }
  return null
}

const listStaged = async (repo: string, env: GitEnv): Promise<string[]> =>
  splitZ((await git(repo, ['diff', '--cached', '--name-only', '--no-renames', '-z'], env)).stdout)

const listCommitted = async (repo: string, sha: string): Promise<string[]> =>
  splitZ(
    (await git(repo, ['diff-tree', '--root', '--no-commit-id', '--no-renames', '--name-only', '-r', '-z', sha])).stdout
  )

/** Populate the temporary index for the requested stage and return its staged path set. */
const prepareIndex = async (
  repo: string,
  head: string | null,
  paths: string[],
  stage: CommitStage,
  tempIndex: string
): Promise<string[]> => {
  const env = { GIT_INDEX_FILE: tempIndex }
  if (stage === 'paths') {
    // Seeded from HEAD, never from the real index, so another actor's staged
    // entries cannot ride along.
    await git(repo, head === null ? ['read-tree', '--empty'] : ['read-tree', head], env)
    await git(repo, ['--literal-pathspecs', 'add', '--', ...paths], env)
  } else {
    const realIndex = path.resolve(repo, (await git(repo, ['rev-parse', '--git-path', 'index'])).stdout.trim())
    const st = await lstatOrNull(realIndex)
    if (st === null) {
      await git(repo, ['read-tree', '--empty'], env)
    } else {
      await fs.copyFile(realIndex, tempIndex)
      // Keep the original mtime so Git's racy-entry detection behaves as it would on the real index.
      await fs.utimes(tempIndex, st.atime, st.mtime)
    }
  }
  return listStaged(repo, env)
}

// --- serialisation -------------------------------------------------------------

const repoQueues = new Map<string, Promise<void>>()

/** Run `fn` after every earlier call for the same repository has settled. */
const serialise = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const run = (repoQueues.get(key) ?? Promise.resolve()).then(fn)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  repoQueues.set(key, tail)
  void tail.then(() => {
    if (repoQueues.get(key) === tail) repoQueues.delete(key)
  })
  return run
}

// --- commit --------------------------------------------------------------------

const commitLocked = async (repo: string, opts: CommitOptions): Promise<CommitResult> => {
  const paths = [...new Set(opts.paths)]
  const commitArgs = ['commit']
  if (opts.dry_run) commitArgs.push('--dry-run')
  if (opts.allow_empty) commitArgs.push('--allow-empty')
  commitArgs.push('-m', opts.message)

  const base: CommitResult = {
    ok: false,
    error: null,
    abs_path: repo,
    ran_at: new Date().toISOString(),
    dry_run: opts.dry_run,
    stage: opts.stage,
    staged_paths: [],
    skipped_paths: [],
    rejected_paths: [],
    hook_modified_paths: [],
    message: opts.message,
    command: ['git', ...commitArgs].join(' '),
    sha: null,
    stdout: '',
    stderr: ''
  }
  const fail = (error: string, extra: Partial<CommitResult> = {}): CommitResult => ({
    ...base,
    ...extra,
    ok: false,
    error
  })

  const head = await readHead(repo)
  const inProgress = await readInProgressOperation(repo)
  if (inProgress !== null) return fail(`a ${inProgress} is in progress; conclude or abort it before committing`)

  const gitDir = (await git(repo, ['rev-parse', '--absolute-git-dir'])).stdout.trim()
  const tempIndex = path.join(gitDir, `mcp-git-audit-index-${randomUUID()}`)
  try {
    // The temporary index does not exist yet, so it doubles as the empty index for the ignore check.
    const rejected = await validatePaths(repo, head, paths, opts.stage, tempIndex)
    if (rejected.length > 0) {
      return fail(`${rejected.length} path(s) rejected; nothing was staged or committed`, { rejected_paths: rejected })
    }

    let staged: string[]
    try {
      staged = await prepareIndex(repo, head, paths, opts.stage, tempIndex)
    } catch (err) {
      return fail(`preparing the temporary index failed; nothing was committed: ${errMessage(err)}`)
    }

    if (opts.stage === 'prepared_index') {
      const named = new Set(paths)
      const stagedSet = new Set(staged)
      const mismatch: RejectedPath[] = [
        ...staged.filter((p) => !named.has(p)).map((p) => ({ path: p, reason: 'staged but not named in paths' })),
        ...paths.filter((p) => !stagedSet.has(p)).map((p) => ({ path: p, reason: 'named in paths but not staged' }))
      ]
      if (mismatch.length > 0) {
        return fail('the staged path set does not equal paths; nothing was committed', {
          staged_paths: staged,
          rejected_paths: mismatch
        })
      }
    }

    const prepared = {
      staged_paths: staged,
      skipped_paths: paths.filter((p) => !staged.includes(p))
    }
    if (staged.length === 0 && !opts.allow_empty) {
      return fail('nothing to commit: every named path matches HEAD', prepared)
    }
    if ((await readHead(repo)) !== head) {
      return fail('HEAD moved while the commit was being prepared; nothing was committed', prepared)
    }

    let stdout: string
    let stderr: string
    try {
      ;({ stdout, stderr } = await git(repo, commitArgs, { GIT_INDEX_FILE: tempIndex }))
    } catch (err) {
      const streams = err as { stdout: string; stderr: string }
      return fail(`git commit failed; nothing was committed: ${errMessage(err)}`, {
        ...prepared,
        stdout: streams.stdout,
        stderr: streams.stderr
      })
    }
    if (opts.dry_run) return { ...base, ...prepared, ok: true, stdout, stderr }

    // A real commit exists from here on. It is never reset, amended or rewritten.
    const fullSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim()
    const sha = (await git(repo, ['rev-parse', '--short', fullSha])).stdout.trim()
    const committed = await listCommitted(repo, fullSha)
    const committedSet = new Set(committed)
    const stagedSet = new Set(staged)
    const hook_modified_paths = [
      ...committed.filter((p) => !stagedSet.has(p)),
      ...staged.filter((p) => !committedSet.has(p))
    ].sort()
    const after = { ...prepared, sha, stdout, stderr, hook_modified_paths }

    if ((await readParent(repo, fullSha)) !== head) {
      return fail(
        `HEAD ${sha} is not a direct child of the prepared HEAD; the real index was not updated and history was left as found`,
        after
      )
    }

    const problems: string[] = []
    if (hook_modified_paths.length > 0) {
      problems.push(
        `commit ${sha} was kept but its path set differs from the approved paths (a hook changed it); it was not reset or amended`
      )
    }
    // Match `git commit --only`: the committed paths' real-index entries take
    // their committed content; every other real-index entry is left untouched.
    if (committed.length > 0) {
      try {
        await git(repo, ['--literal-pathspecs', 'reset', '-q', fullSha, '--', ...committed])
      } catch (err) {
        problems.push(`commit ${sha} was created but the real index was not updated: ${errMessage(err)}`)
      }
    }
    if (problems.length > 0) return fail(problems.join('; '), after)
    return { ...base, ...after, ok: true }
  } finally {
    await fs.rm(tempIndex, { force: true })
    await fs.rm(`${tempIndex}.lock`, { force: true })
  }
}

/**
 * Commit exactly the named paths. Destructive: writes a commit object and
 * moves HEAD when `dry_run` is false.
 *
 * The commit is built in a temporary `GIT_INDEX_FILE` under the repository's
 * Git directory and removed afterwards, so a preview, a refusal or a failure
 * never changes the real index. `paths` seeds that index from `HEAD` and adds
 * only the named paths; `prepared_index` copies the real index after
 * confirming its staged path set equals `paths` exactly. After a real commit
 * the real index entries for exactly the committed paths take their committed
 * content, as `git commit --only` does; unrelated staged entries survive.
 *
 * Calls are serialised per repository within this process and every call
 * revalidates from scratch; a preview grants no later authority. Hooks run.
 * A commit whose path set differs from the approved set is reported with
 * `ok: false`, its SHA and `hook_modified_paths`, and is never rewritten.
 *
 * Input-shape errors (message, empty `paths`, safe-root containment) throw;
 * every repository-state refusal returns `ok: false` with `error`.
 */
export const commitRepo = async (
  safeRoots: readonly string[],
  absPath: string,
  opts: CommitOptions
): Promise<CommitResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, safeRoots)
  if (opts.message.length === 0) throw new Error('commit message must not be empty')
  if (/[\r\n]/.test(opts.message)) throw new Error('commit message must be a single line (no newline characters)')
  if (opts.paths.length === 0) throw new Error(`paths is required and must be non-empty (stage="${opts.stage}")`)
  return serialise(resolved, () => commitLocked(resolved, opts))
}
