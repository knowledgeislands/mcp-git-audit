import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { errMessage } from '../../utils/errors.js'
import { GIT_LOCAL_TIMEOUT_MS, runGitCapture } from '../../utils/git-exec.js'
import { resolveGitMetadata } from './metadata.js'

/** At most this many submodule entries are returned per repository; the rest are counted as omitted. */
export const MAX_SUBMODULE_ENTRIES = 100

const GITLINK_MODE = '160000'

export type SummaryStatus = 'available' | 'unavailable'

export interface StashSummary {
  status: SummaryStatus
  /** Number of stash entries; null when unavailable (never a zero stand-in). */
  count: number | null
  error?: string
}

export type SubmoduleState = 'uninitialised' | 'matched' | 'changed' | 'unavailable'

export interface SubmoduleEntry {
  /** Literal repository-relative path of the gitlink. */
  path: string
  /** Commit recorded for the gitlink in the parent's index. */
  expected_commit: string
  /** Commit checked out in the child; null unless it could be read from authorised metadata. */
  actual_commit: string | null
  state: SubmoduleState
  /** Whether the child has working-tree changes; null when not inspected or unreadable. */
  dirty: boolean | null
}

export interface SubmoduleSummary {
  status: SummaryStatus
  /** Number of first-level gitlinks; null when unavailable. */
  total: number | null
  /** Gitlinks beyond the entry limit; null when unavailable. */
  omitted: number | null
  /** At most `MAX_SUBMODULE_ENTRIES`, sorted bytewise by path. */
  entries: SubmoduleEntry[]
  error?: string
}

const git = async (repo: string, args: string[]): Promise<string> =>
  (await runGitCapture(repo, args, GIT_LOCAL_TIMEOUT_MS)).stdout

/** Count retained stash entries. Subjects are never read or returned. */
export const stashSummary = async (repoDir: string): Promise<StashSummary> => {
  try {
    const out = await git(repoDir, ['stash', 'list', '--format=%gd'])
    return { status: 'available', count: out.split('\n').filter((l) => l.length > 0).length }
  } catch (err) {
    return { status: 'unavailable', count: null, error: errMessage(err) }
  }
}

interface Gitlink {
  path: string
  commit: string
  conflicted: boolean
}

const STAGE_RECORD = /^(\d+) ([0-9a-f]+) (\d)\t(.+)$/s

/**
 * Parse `git ls-files --stage -z` output (`<mode> <object> <stage>\t<path>\0`)
 * into first-level gitlinks. A stage-0 entry wins; a path present only at
 * conflict stages is kept (lowest stage) and flagged as conflicted.
 */
const parseGitlinks = (out: string): Gitlink[] => {
  const byPath = new Map<string, Gitlink>()
  for (const record of out.split('\0')) {
    const m = STAGE_RECORD.exec(record)
    if (m === null || m[1] !== GITLINK_MODE) continue
    const p = m[4] as string
    // ls-files lists a path's stages in ascending order, so the first record seen is stage 0 or the lowest conflict stage.
    if (!byPath.has(p)) byPath.set(p, { path: p, commit: m[2] as string, conflicted: m[3] !== '0' })
  }
  // The index is kept sorted bytewise by path, so insertion order is already the documented order.
  return [...byPath.values()]
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

const inspectChild = async (safeRoots: readonly string[], repoDir: string, link: Gitlink): Promise<SubmoduleEntry> => {
  const entry = (
    state: SubmoduleState,
    actual: string | null = null,
    dirty: boolean | null = null
  ): SubmoduleEntry => ({
    path: link.path,
    expected_commit: link.commit,
    actual_commit: actual,
    state,
    dirty
  })
  if (link.conflicted) return entry('unavailable')
  const childDir = path.join(repoDir, link.path)
  if (!(await exists(path.join(childDir, '.git')))) return entry('uninitialised')
  let workTree: string
  try {
    workTree = (await resolveGitMetadata(safeRoots, childDir)).work_tree
  } catch {
    return entry('unavailable')
  }
  let actual: string
  try {
    actual = (await git(workTree, ['rev-parse', '--verify', '-q', 'HEAD'])).trim()
  } catch {
    return entry('unavailable')
  }
  let dirty: boolean | null = null
  try {
    dirty = (await git(workTree, ['status', '--porcelain', '--ignore-submodules=all'])).length > 0
  } catch {
    dirty = null
  }
  return entry(actual === link.commit ? 'matched' : 'changed', actual, dirty)
}

/**
 * Summarise first-level submodules of `repoDir` from the gitlinks in its index.
 * Never fetches, initialises or recurses: only tracked first-level gitlinks are
 * listed, and Git runs inside a child only after `resolveGitMetadata` has
 * authorised the child directory and its metadata against `safeRoots`.
 * Children are inspected sequentially, bounded by `MAX_SUBMODULE_ENTRIES`.
 */
export const submoduleSummary = async (safeRoots: readonly string[], repoDir: string): Promise<SubmoduleSummary> => {
  let links: Gitlink[]
  try {
    links = parseGitlinks(await git(repoDir, ['ls-files', '--stage', '-z']))
  } catch (err) {
    return { status: 'unavailable', total: null, omitted: null, entries: [], error: errMessage(err) }
  }
  const kept = links.slice(0, MAX_SUBMODULE_ENTRIES)
  const entries: SubmoduleEntry[] = []
  for (const link of kept) entries.push(await inspectChild(safeRoots, repoDir, link))
  return { status: 'available', total: links.length, omitted: links.length - kept.length, entries }
}

/** Submodule summary when no safe roots were supplied, so children cannot be authorised. */
export const submodulesWithoutAuthority = (): SubmoduleSummary => ({
  status: 'unavailable',
  total: null,
  omitted: null,
  entries: [],
  error: 'submodule inspection requires safe roots (use auditScanWithinRoots)'
})
