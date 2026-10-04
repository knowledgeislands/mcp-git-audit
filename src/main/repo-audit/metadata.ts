import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { isNodeError } from '../../utils/errors.js'
import { expandHome, resolveAgainstSafeRoots } from '../../utils/paths.js'

/**
 * Upper bound on a `.git` pointer or `commondir` file. Git writes a single
 * short line; anything larger is treated as malformed rather than read.
 */
const MAX_POINTER_BYTES = 4096

const PREFIX = 'unsupported Git metadata'

export interface GitMetadata {
  /** Realpath of the working directory. */
  work_tree: string
  /** `directory` for an ordinary `.git` directory, `pointer` for a `.git` file (linked worktree or submodule). */
  kind: 'directory' | 'pointer'
  /** Realpath of the per-worktree Git directory. */
  git_dir: string
  /** Realpath of the common Git directory (equal to `git_dir` when no `commondir` file exists). */
  common_dir: string
}

const fail = (detail: string): never => {
  throw new Error(`${PREFIX}: ${detail}`)
}

/** Realpath `p` and require an existing directory, distinguishing symlink loops from missing targets. */
const realDirectory = async (p: string, label: string): Promise<string> => {
  let real: string
  try {
    real = await fs.realpath(p)
  } catch (err) {
    if (isNodeError(err) && err.code === 'ELOOP') return fail(`${label} is cyclic (symlink loop): ${p}`)
    return fail(`${label} does not exist: ${p}`)
  }
  const st = await fs.stat(real)
  if (!st.isDirectory()) fail(`${label} is not a directory: ${p}`)
  return real
}

const authorise = async (real: string, label: string, safeRoots: readonly string[]): Promise<void> => {
  try {
    await resolveAgainstSafeRoots(real, safeRoots)
  } catch {
    fail(`${label} escapes the configured safe roots: ${real}`)
  }
}

/**
 * Read a single-line pointer file (`.git` or `commondir`) after confirming it
 * is a bounded regular file. Trailing whitespace is trimmed, as Git does.
 */
const readPointer = async (file: string, label: string): Promise<string> => {
  const st = await fs.lstat(file)
  if (!st.isFile()) fail(`${label} is not a regular file: ${file}`)
  if (st.size > MAX_POINTER_BYTES) fail(`${label} exceeds ${MAX_POINTER_BYTES} bytes: ${file}`)
  const body = (await fs.readFile(file, 'utf-8')).replace(/\s+$/, '')
  if (body.length === 0 || /[\r\n\0]/.test(body)) fail(`${label} is malformed: ${file}`)
  return body
}

const resolveGitDir = async (
  workTree: string,
  dotGit: string
): Promise<{ kind: GitMetadata['kind']; gitDir: string }> => {
  let st: import('node:fs').Stats
  try {
    st = await fs.lstat(dotGit)
  } catch {
    return fail(`no .git entry in ${workTree} (not a repository root)`)
  }
  if (st.isDirectory()) return { kind: 'directory', gitDir: dotGit }
  if (!st.isFile()) return fail(`.git entry is neither a directory nor a regular file: ${dotGit}`)
  const body = await readPointer(dotGit, '.git pointer')
  if (!body.startsWith('gitdir: ') || body.length === 'gitdir: '.length) fail(`.git pointer is malformed: ${dotGit}`)
  const target = path.resolve(workTree, body.slice('gitdir: '.length))
  const gitDir = await realDirectory(target, 'gitdir target')
  if (gitDir === workTree) fail(`gitdir target is cyclic (points at its own working tree): ${dotGit}`)
  return { kind: 'pointer', gitDir }
}

const resolveCommonDir = async (gitDir: string): Promise<string> => {
  const file = path.join(gitDir, 'commondir')
  try {
    await fs.lstat(file)
  } catch {
    return gitDir
  }
  const body = await readPointer(file, 'commondir')
  return realDirectory(path.resolve(gitDir, body), 'commondir target')
}

/**
 * Authorise every Git metadata location that a `git -C <repoDir>` invocation
 * would read, before any Git process runs.
 *
 * - The working directory must exist, be contained by `safeRoots`, and carry
 *   its own `.git` entry: without one Git would discover an ancestor
 *   repository, which may lie outside the safe roots.
 * - A `.git` directory is used as is; a regular `.git` file must be a single
 *   `gitdir: <path>` line (relative targets resolve against the working
 *   directory) naming an existing directory. Symlinked `.git` entries are
 *   unsupported.
 * - The Git directory and any `commondir` target are realpathed and must lie
 *   within `safeRoots`. Metadata authority is never inferred from a permitted
 *   working directory.
 *
 * Throws an `unsupported Git metadata: ...` error for malformed, oversized,
 * dangling, cyclic or escaping metadata.
 */
export const resolveGitMetadata = async (safeRoots: readonly string[], repoDir: string): Promise<GitMetadata> => {
  await resolveAgainstSafeRoots(repoDir, safeRoots)
  const workTree = await realDirectory(expandHome(repoDir), 'repository directory')
  const { kind, gitDir } = await resolveGitDir(workTree, path.join(workTree, '.git'))
  await authorise(gitDir, 'gitdir target', safeRoots)
  const commonDir = await resolveCommonDir(gitDir)
  if (commonDir !== gitDir) await authorise(commonDir, 'commondir target', safeRoots)
  return { work_tree: workTree, kind, git_dir: gitDir, common_dir: commonDir }
}
