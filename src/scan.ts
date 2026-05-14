import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { isNodeError } from './utils.js'

export interface ScannedRepo {
  path: string
  abs_path: string
  group: string
  name: string
}

export interface ScanResult {
  root: string
  scanned_at: string
  repos: ScannedRepo[]
}

export interface ScanOptions {
  max_depth: number
}

const groupAndName = (relPath: string): { group: string; name: string } => {
  const parts = relPath.split('/').filter((p) => p.length > 0)
  /* v8 ignore next -- parts[0] is only undefined when relPath is empty (root-is-repo), which findRepos filters at depth 0. Defensive fallback. */
  if (parts.length <= 1) return { group: '(root)', name: parts[0] ?? '' }
  return { group: parts[0], name: parts[parts.length - 1] }
}

/**
 * Walk `root` looking for `.git` directories. A repo is any directory that
 * contains `.git` as a subdirectory (worktree-pointer `.git` files are skipped
 * — out of scope for v1). When a repo is found we do not recurse into it.
 * Hidden directories and `node_modules` are skipped. Returns absolute repo paths.
 *
 * `maxDepth` is the maximum depth (measured from `root`) at which a repo
 * directory may live. With `root=~/dev` and `maxDepth=2`, `~/dev/group/repo`
 * (depth 2) is included; deeper repos are not.
 */
export const findRepos = async (root: string, maxDepth: number): Promise<string[]> => {
  const repos: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    /* v8 ignore next -- recursion guards `depth + 1 > maxDepth` before re-entering; this top-level check is purely defensive. */
    if (depth > maxDepth) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as import('node:fs').Dirent[]
    } catch (err) {
      // Any filesystem error while walking is treated as "skip this subtree" —
      // missing dirs (ENOENT), permission denials (EACCES/EPERM), or a non-dir
      // that snuck into the loop (ENOTDIR) should not abort the whole audit.
      if (isNodeError(err)) return
      /* v8 ignore next -- non-NodeError rethrow is unreachable in tests; readdir always raises an ErrnoException on failure. */
      throw err
    }
    const gitEntry = entries.find((e) => e.name === '.git')
    if (gitEntry?.isDirectory()) {
      if (depth >= 1) repos.push(dir)
      return
    }
    if (depth >= maxDepth) return
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('.')) continue
      if (e.name === 'node_modules') continue
      await walk(path.join(dir, e.name), depth + 1)
    }
  }
  await walk(root, 0)
  return repos
}

/**
 * Walk the safe-root-constrained tree and return repo metadata. The returned
 * shape is intended to be cached and fed into the audit tool one or more times.
 * No `git` invocations happen here — it's pure filesystem discovery.
 */
export const scanRoot = async (root: string, opts: ScanOptions): Promise<ScanResult> => {
  const scanned_at = new Date().toISOString()
  const repoPaths = await findRepos(root, opts.max_depth)
  const repos: ScannedRepo[] = repoPaths.map((absPath) => {
    const relPath = path.relative(root, absPath).split(path.sep).join('/')
    const { group, name } = groupAndName(relPath)
    return { path: relPath, abs_path: absPath, group, name }
  })
  repos.sort((a, b) => (a.group !== b.group ? a.group.localeCompare(b.group) : a.name.localeCompare(b.name)))
  return { root, scanned_at, repos }
}
