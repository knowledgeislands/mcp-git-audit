import { errMessage } from '../../utils/errors.js'
import { GIT_LOCAL_TIMEOUT_MS, runGitCapture } from '../../utils/git-exec.js'
import { resolveAgainstSafeRoots } from '../../utils/paths.js'
import { resolveGitMetadata } from './metadata.js'
import type { ScannedRepo, ScanResult } from './scan.js'

// Token unlikely to appear in commit subjects; lets us split %s/%ar/%cI safely.
const LOG_SEP = '<<<MGA-SEP>>>'

export interface RepoStatus {
  path: string
  abs_path: string
  group: string
  name: string
  branch: string
  detached: boolean
  sha: string
  subject: string
  rel_date: string
  iso_date: string
  modified: number
  untracked: number
  has_remote: boolean
  remote_url: string | null
  has_upstream: boolean
  ahead: number
  behind: number
}

export interface AuditError {
  path: string
  message: string
}

export interface AuditResult {
  root: string
  scanned_at: string
  audited_at: string
  repos: RepoStatus[]
  errors?: AuditError[]
}

export interface AuditOptions {
  include_stale_days: number
}

const runGit = async (repo: string, args: string[]): Promise<string> => {
  const { stdout } = await runGitCapture(repo, args, GIT_LOCAL_TIMEOUT_MS)
  return stdout
}

const tryRunGit = async (repo: string, args: string[]): Promise<string | null> => {
  try {
    return await runGit(repo, args)
  } catch {
    return null
  }
}

const countStatusLines = (porcelain: string): { modified: number; untracked: number } => {
  let modified = 0
  let untracked = 0
  for (const line of porcelain.split('\n')) {
    if (line.length === 0) continue
    if (line.startsWith('?? ')) untracked++
    else modified++
  }
  return { modified, untracked }
}

export const auditRepo = async (
  repo: ScannedRepo
): Promise<{ ok: true; status: RepoStatus } | { ok: false; error: AuditError }> => {
  try {
    const sha = (await runGit(repo.abs_path, ['rev-parse', '--short', 'HEAD'])).trim()

    const branchOut = (await tryRunGit(repo.abs_path, ['symbolic-ref', '--short', '-q', 'HEAD'])) ?? ''
    const branchName = branchOut.trim()
    const detached = branchName.length === 0
    const branch = detached ? `detached@${sha}` : branchName

    const logOut = await runGit(repo.abs_path, ['log', '-1', `--pretty=format:%s${LOG_SEP}%ar${LOG_SEP}%cI`])
    /* v8 ignore next -- `git log -1` with our format always emits all three fields separated by LOG_SEP; the empty-string defaults are purely defensive. */
    const [subjectRaw = '', relDateRaw = '', isoDateRaw = ''] = logOut.split(LOG_SEP)
    const subject = subjectRaw
    const rel_date = relDateRaw.trim()
    const iso_date = isoDateRaw.trim()

    const porcelain = await runGit(repo.abs_path, ['status', '--porcelain'])
    const { modified, untracked } = countStatusLines(porcelain)

    const remoteOut = await tryRunGit(repo.abs_path, ['remote', 'get-url', 'origin'])
    const remote_url = remoteOut?.trim() || null
    const has_remote = remote_url !== null

    const upstreamOut = await tryRunGit(repo.abs_path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    const has_upstream = upstreamOut !== null && upstreamOut.trim().length > 0

    let ahead = 0
    let behind = 0
    if (has_upstream) {
      const counts = await tryRunGit(repo.abs_path, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
      /* v8 ignore next 5 -- `git rev-list --left-right --count HEAD...@{u}` always returns "<ahead>\t<behind>" when an upstream exists; the empty / NaN / single-token fallbacks are defensive. */
      if (counts) {
        const [a, b] = counts.trim().split(/\s+/)
        ahead = Number.parseInt(a ?? '0', 10) || 0
        behind = Number.parseInt(b ?? '0', 10) || 0
      }
    }

    return {
      ok: true,
      status: {
        path: repo.path,
        abs_path: repo.abs_path,
        group: repo.group,
        name: repo.name,
        branch,
        detached,
        sha,
        subject,
        rel_date,
        iso_date,
        modified,
        untracked,
        has_remote,
        remote_url,
        has_upstream,
        ahead,
        behind
      }
    }
  } catch (err) {
    return { ok: false, error: { path: repo.path, message: errMessage(err) } }
  }
}

const runAudit = async (scan: ScanResult, initialErrors: readonly AuditError[]): Promise<AuditResult> => {
  const audited_at = new Date().toISOString()
  const results = await Promise.all(scan.repos.map((r) => auditRepo(r)))
  const repos: RepoStatus[] = []
  const errors: AuditError[] = [...initialErrors]
  for (const result of results) {
    if (result.ok) repos.push(result.status)
    else errors.push(result.error)
  }
  repos.sort((a, b) => (a.group !== b.group ? a.group.localeCompare(b.group) : a.name.localeCompare(b.name)))
  errors.sort((a, b) => a.path.localeCompare(b.path))
  const out: AuditResult = { root: scan.root, scanned_at: scan.scanned_at, audited_at, repos }
  if (errors.length > 0) out.errors = errors
  return out
}

/**
 * Run per-repo audits over a pre-computed scan result. Idempotent and safe to
 * call multiple times against a cached scan, which is the point of the
 * scan/audit split — the cheap filesystem walk happens once, the more expensive
 * `git` calls can be re-run on demand.
 *
 * The caller is responsible for authorising every path; prefer
 * `auditScanWithinRoots`, which does so before any `git` call.
 */
export const auditScan = async (scan: ScanResult, _opts: AuditOptions): Promise<AuditResult> => runAudit(scan, [])

/**
 * Authorise a (possibly cached, caller-supplied) scan against `safeRoots` and
 * audit it. The root and every `abs_path` are revalidated first; an escaping
 * path rejects the whole call, so a cached scan cannot widen the boundary.
 * Each repository's Git metadata (`.git` directory or pointer, `gitdir` and
 * `commondir` targets) is then authorised by `resolveGitMetadata`; a repository
 * whose metadata is unsupported or escapes the safe roots is reported in
 * `errors` and no `git` process runs for it.
 */
export const auditScanWithinRoots = async (
  safeRoots: readonly string[],
  scan: ScanResult,
  _opts: AuditOptions
): Promise<AuditResult> => {
  const root = await resolveAgainstSafeRoots(scan.root, safeRoots)
  for (const r of scan.repos) {
    try {
      await resolveAgainstSafeRoots(r.abs_path, safeRoots)
    } catch (err) {
      throw new Error(`scan.repos[${r.path}].abs_path: ${errMessage(err)}`)
    }
  }
  const authorised: ScannedRepo[] = []
  const errors: AuditError[] = []
  for (const r of scan.repos) {
    try {
      const metadata = await resolveGitMetadata(safeRoots, r.abs_path)
      authorised.push({ ...r, abs_path: metadata.work_tree })
    } catch (err) {
      errors.push({ path: r.path, message: errMessage(err) })
    }
  }
  return runAudit({ ...scan, root, repos: authorised }, errors)
}
