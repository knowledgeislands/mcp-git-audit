import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { errMessage } from '../../utils/errors.js'
import type { ScannedRepo, ScanResult } from './scan.js'

const execFileP = promisify(execFile)

const GIT_TIMEOUT_MS = 8000
const GIT_MAX_BUFFER = 4 * 1024 * 1024
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
  const { stdout } = await execFileP('git', ['--no-optional-locks', '-C', repo, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER
  })
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

export const auditRepo = async (repo: ScannedRepo): Promise<{ ok: true; status: RepoStatus } | { ok: false; error: AuditError }> => {
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

    const remoteOut = await runGit(repo.abs_path, ['remote'])
    const has_remote = remoteOut.trim().length > 0

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
        has_upstream,
        ahead,
        behind
      }
    }
  } catch (err) {
    return { ok: false, error: { path: repo.path, message: errMessage(err) } }
  }
}

/**
 * Run per-repo audits over a pre-computed scan result. Idempotent and safe to
 * call multiple times against a cached scan, which is the point of the
 * scan/audit split — the cheap filesystem walk happens once, the more expensive
 * `git` calls can be re-run on demand.
 */
export const auditScan = async (scan: ScanResult, _opts: AuditOptions): Promise<AuditResult> => {
  const audited_at = new Date().toISOString()
  const results = await Promise.all(scan.repos.map((r) => auditRepo(r)))
  const repos: RepoStatus[] = []
  const errors: AuditError[] = []
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
