import * as fs from 'node:fs/promises'
import { errMessage } from '../../utils/errors.js'
import { expandHome, resolveAgainstSafeRoots } from '../../utils/paths.js'
import { type AuditError, auditScanWithinRoots, type RepoStatus } from './audit.js'
import { scanRoot } from './scan.js'

export interface AuditRootsOptions {
  /** Maximum depth, from each root, at which a repository directory may live. */
  max_depth: number
  /** Whole-request cap on repositories selected for `git` auditing. */
  limit: number
}

export type RootAuditStatus = 'ok' | 'partial' | 'error'

export interface RootAuditResult {
  /** The root as the caller supplied it. */
  requested: string
  /**
   * The canonical, symlink-resolved root. A root that does not exist has no
   * canonical form, so it is reported as requested after `~/` expansion.
   */
  root: string
  status: RootAuditStatus
  scanned_at: string | null
  audited_at: string | null
  repos: RepoStatus[]
  errors: AuditError[]
  /** Repositories found under this root but not selected because the request limit was reached. */
  omitted: number
}

export interface DuplicateRoot {
  requested: string
  canonical: string
  /** Index into `roots` of the result that already covers this canonical root. */
  duplicate_of_index: number
}

export interface AuditRootsResult {
  requested_at: string
  limit: number
  max_depth: number
  roots: RootAuditResult[]
  duplicate_roots: DuplicateRoot[]
}

interface ResolvedRoot {
  requested: string
  root: string
  /** Why the authorised root cannot be reached, or null when it exists. */
  unreachable: string | null
}

/**
 * Authorise one requested root, then canonicalise it.
 *
 * `resolveAgainstSafeRoots` authorises a missing path through its deepest
 * existing ancestor and returns that ancestor, which must not become the root
 * walked. A root that cannot be realpath-resolved is therefore kept as a
 * per-root failure and never accessed through a lexically normalised form,
 * which could otherwise step outside the authorised ancestor via `..`.
 */
const resolveRequestedRoot = async (requested: string, safeRoots: readonly string[]): Promise<ResolvedRoot> => {
  const authorised = await resolveAgainstSafeRoots(requested, safeRoots)
  const expanded = expandHome(requested)
  try {
    const real = await fs.realpath(expanded)
    /* v8 ignore next -- an existing path's deepest existing ancestor is itself, so both resolutions agree barring a concurrent rename. */
    if (real !== authorised) throw new Error('root changed while it was being resolved')
    return { requested, root: real, unreachable: null }
  } catch (err) {
    return { requested, root: expanded, unreachable: errMessage(err) }
  }
}

/**
 * Audit several explicitly requested roots in one call (MCP-GIT-TOOL-003).
 *
 * Every root is authorised and canonicalised before any root is traversed, so
 * a relative or escaping root rejects the whole request without touching its
 * peers. Exact canonical duplicates are dropped in favour of the first request
 * and reported; overlapping distinct roots stay separate and may repeat
 * repositories.
 *
 * Roots are then processed sequentially. Each is scanned in full, so its
 * `omitted` count is truthful, and its repositories are selected in scan order
 * until the whole-request `limit` is spent; only selected repositories run
 * `git`. A root that is absent or not a directory is a per-root `error`, and a
 * root with per-repository errors or omissions is `partial`; neither affects
 * its peers. The limit bounds payload and Git work, not elapsed time or the
 * filesystem entries a scan visits.
 */
export const auditRootsWithinSafeRoots = async (
  safeRoots: readonly string[],
  requestedRoots: readonly string[],
  opts: AuditRootsOptions
): Promise<AuditRootsResult> => {
  const requested_at = new Date().toISOString()

  const resolved: ResolvedRoot[] = []
  for (const [index, requested] of requestedRoots.entries()) {
    try {
      resolved.push(await resolveRequestedRoot(requested, safeRoots))
    } catch (err) {
      throw new Error(`roots[${index}]: ${errMessage(err)}`)
    }
  }

  const unique: ResolvedRoot[] = []
  const duplicate_roots: DuplicateRoot[] = []
  for (const entry of resolved) {
    const first = unique.findIndex((kept) => kept.root === entry.root)
    if (first >= 0)
      duplicate_roots.push({ requested: entry.requested, canonical: entry.root, duplicate_of_index: first })
    else unique.push(entry)
  }

  let remaining = opts.limit
  const roots: RootAuditResult[] = []
  for (const { requested, root, unreachable } of unique) {
    const failed = (message: string): RootAuditResult => ({
      requested,
      root,
      status: 'error',
      scanned_at: null,
      audited_at: null,
      repos: [],
      errors: [{ path: root, message }],
      omitted: 0
    })

    if (unreachable !== null) {
      roots.push(failed(`root is not accessible: ${unreachable}`))
      continue
    }
    try {
      const state = await fs.stat(root)
      if (!state.isDirectory()) {
        roots.push(failed('root is not a directory'))
        continue
      }
      const scan = await scanRoot(root, { max_depth: opts.max_depth })
      const selected = scan.repos.slice(0, remaining)
      const omitted = scan.repos.length - selected.length
      remaining -= selected.length
      const audit =
        selected.length > 0
          ? await auditScanWithinRoots(safeRoots, { ...scan, repos: selected }, { include_stale_days: 30 })
          : { audited_at: null, repos: [], errors: [] }
      const errors = audit.errors ?? []
      roots.push({
        requested,
        root,
        status: errors.length > 0 || omitted > 0 ? 'partial' : 'ok',
        scanned_at: scan.scanned_at,
        audited_at: audit.audited_at,
        repos: audit.repos,
        errors,
        omitted
      })
    } catch (err) {
      /* v8 ignore next -- the root was realpath-resolved moments earlier, scanning swallows filesystem errors and every selected path was authorised above, so only a concurrent removal reaches this; kept so one root's fault never fails its peers. */
      roots.push(failed(`root is not accessible: ${errMessage(err)}`))
    }
  }

  return { requested_at, limit: opts.limit, max_depth: opts.max_depth, roots, duplicate_roots }
}
