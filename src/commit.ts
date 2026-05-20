import { SAFE_ROOTS } from './config.js'
import { errMessage } from './utils/errors.js'
import { GIT_LOCAL_TIMEOUT_MS, runGitCapture } from './utils/git-exec.js'
import { resolveAgainstSafeRoots } from './utils/paths.js'

export type CommitStage = 'all_tracked' | 'all' | 'paths' | 'none'

export interface CommitOptions {
  message: string
  stage: CommitStage
  paths?: string[]
  dry_run: boolean
  allow_empty: boolean
}

export interface CommitResult {
  abs_path: string
  ran_at: string
  dry_run: boolean
  stage: CommitStage
  staged_paths: string[]
  message: string
  command: string[]
  sha: string | null
  stdout: string
  stderr: string
}

// Tighter than the schema-side check so direct callers (tests, future tools)
// can't slip an option-injecting or escaping pathspec through.
const REL_PATH_RE = /^(?!-)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\r\n]{1,4096}$/

const validateRelPaths = (paths: readonly string[] | undefined): string[] => {
  if (paths === undefined) return []
  const out: string[] = []
  for (const p of paths) {
    if (!REL_PATH_RE.test(p)) {
      throw new Error(`invalid path "${p}": must be repo-relative, no leading "-" or "/", no ".." segments, no NUL/newline`)
    }
    out.push(p)
  }
  return out
}

const stageArgs = (stage: CommitStage, paths: readonly string[]): string[] | null => {
  switch (stage) {
    case 'all_tracked':
      return ['add', '-u']
    case 'all':
      return ['add', '-A']
    case 'paths':
      return ['add', '--', ...paths]
    case 'none':
      return null
  }
}

const readStagedPaths = async (resolvedRepo: string): Promise<string[]> => {
  const { stdout } = await runGitCapture(resolvedRepo, ['diff', '--cached', '--name-only', '-z'], GIT_LOCAL_TIMEOUT_MS)
  return stdout.split('\0').filter((p) => p.length > 0)
}

const readHeadSha = async (resolvedRepo: string): Promise<string> => {
  const { stdout } = await runGitCapture(resolvedRepo, ['rev-parse', '--short', 'HEAD'], GIT_LOCAL_TIMEOUT_MS)
  return stdout.trim()
}

/**
 * Stage files and create a commit in one call. Destructive — writes to the
 * git object store and refs (or to the index alone, on `dry_run`).
 *
 * `dry_run=true` (the default) still runs the staging step — the index is
 * local, fully reversible state, and the artifact preview needs to know what
 * `git commit` would actually write. Only the commit itself is skipped (via
 * `git commit --dry-run`, which prints the would-be summary without writing
 * an object or moving HEAD).
 *
 * When `stage === 'paths'`, every path must be repo-relative, free of `..`
 * segments, must not start with `-` or `/`, and must not contain NUL or
 * newline characters — this matches the validators in `git-exec.ts` and
 * defends in depth against option-injection through the pathspec.
 */
export const commitRepo = async (absPath: string, opts: CommitOptions): Promise<CommitResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, SAFE_ROOTS)
  const ran_at = new Date().toISOString()

  if (opts.message.length === 0) throw new Error('commit message must not be empty')
  if (opts.message.includes('\n')) throw new Error('commit message must be a single line (no newline characters)')

  const paths = validateRelPaths(opts.paths)
  if (opts.stage === 'paths' && paths.length === 0) {
    throw new Error('paths is required when stage="paths"')
  }
  if (opts.stage !== 'paths' && paths.length > 0) {
    throw new Error(`paths is only allowed when stage="paths" (got stage="${opts.stage}")`)
  }

  // Stage step (skipped on stage='none').
  const stArgs = stageArgs(opts.stage, paths)
  let stageStderr = ''
  if (stArgs !== null) {
    try {
      const { stderr } = await runGitCapture(resolved, stArgs, GIT_LOCAL_TIMEOUT_MS)
      stageStderr = stderr
    } catch (err) {
      throw new Error(`git add failed: ${errMessage(err)}`)
    }
  }

  const staged_paths = await readStagedPaths(resolved)

  // Build the commit argv. `--dry-run` first so `command` reads naturally.
  const commitArgs: string[] = ['commit']
  if (opts.dry_run) commitArgs.push('--dry-run')
  if (opts.allow_empty) commitArgs.push('--allow-empty')
  commitArgs.push('-m', opts.message)

  let stdout = ''
  let stderr = ''
  try {
    const r = await runGitCapture(resolved, commitArgs, GIT_LOCAL_TIMEOUT_MS)
    stdout = r.stdout
    stderr = r.stderr
  } catch (err) {
    throw new Error(`git commit failed: ${errMessage(err)}`)
  }

  let sha: string | null = null
  if (!opts.dry_run) {
    try {
      sha = await readHeadSha(resolved)
    } catch (err) {
      /* v8 ignore next 2 -- `rev-parse HEAD` only fails on an unborn branch, and a successful non-empty commit always produces a HEAD; defence in depth. */
      throw new Error(`git rev-parse HEAD failed after commit: ${errMessage(err)}`)
    }
  }

  return {
    abs_path: resolved,
    ran_at,
    dry_run: opts.dry_run,
    stage: opts.stage,
    staged_paths,
    message: opts.message,
    command: ['git', ...commitArgs],
    sha,
    stdout,
    /* v8 ignore next -- `git add` is silent on success; the non-empty stageStderr branch is defence in depth for future warning lines. */
    stderr: stageStderr.length > 0 ? `${stageStderr}${stderr}` : stderr
  }
}
