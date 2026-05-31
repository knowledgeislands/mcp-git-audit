import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { errMessage } from '../../utils/errors.js'
import { resolveAndLocateAgainstSafeRoots } from '../../utils/paths.js'

const execFileP = promisify(execFile)

// Intentionally shorter than GIT_LOCAL_TIMEOUT_MS (8s): detail is a quick per-repo
// metadata read, so it fails faster than the heavier audit/scan local commands.
const DETAIL_TIMEOUT_MS = 6000
const DETAIL_MAX_BUFFER = 8 * 1024 * 1024
const MAX_COMMITS = 50

// Tokens unlikely to appear in commit subjects; lets us split commit records
// and field blocks safely without depending on newline behaviour around merges.
const COMMIT_SEP = '<<<MGA-COMMIT>>>'
const FIELD_SEP = '<<<MGA-FIELD>>>'

export interface DiffstatEntry {
  added: number
  removed: number
  path: string
}

export interface CommitDetail {
  sha: string
  subject: string
  author: string
  iso_date: string
  rel_date: string
  files: number
  diffstat?: DiffstatEntry[]
}

export interface WorkingTreeEntry {
  status: string
  path: string
}

export interface WorkingTreeReport {
  modified: WorkingTreeEntry[]
  summary: { modified: number; untracked: number }
}

export interface RepoDetailResult {
  abs_path: string
  path: string
  fetched_at: string
  commits: CommitDetail[]
  working_tree: WorkingTreeReport
  error?: string
}

export interface RepoDetailOptions {
  commits: number
  include_diffstat: boolean
}

const DIFFSTAT_LINE = /^(\d+|-)\t(\d+|-)\t(.+)$/

const parseDiffstatLine = (line: string): DiffstatEntry | null => {
  const m = DIFFSTAT_LINE.exec(line)
  /* v8 ignore next -- `git log --numstat` always emits TAB-separated lines matching this pattern; this null is defence in depth. */
  if (!m) return null
  // Binary files report "-" for both counts; `|| 0` coerces the resulting NaN to 0 in a single expression.
  const added = Number.parseInt(m[1] as string, 10) || 0
  const removed = Number.parseInt(m[2] as string, 10) || 0
  return { added, removed, path: m[3] as string }
}

const parseLogOutput = (out: string, includeDiffstat: boolean): CommitDetail[] => {
  const chunks = out.split(COMMIT_SEP).slice(1)
  const commits: CommitDetail[] = []
  for (const chunk of chunks) {
    const newlineIdx = chunk.indexOf('\n')
    /* v8 ignore next 2 -- `--numstat` always emits at least one newline per commit (the line break after the format line); defensive skip. */
    if (newlineIdx < 0) continue
    const header = chunk.slice(0, newlineIdx)
    const rest = chunk.slice(newlineIdx + 1)
    const fields = header.split(FIELD_SEP)
    /* v8 ignore next -- pretty-format always emits all five fields; defensive skip. */
    if (fields.length < 5) continue
    const [sha, subject, author, iso_date, rel_date] = fields as [string, string, string, string, string]
    const diffstat: DiffstatEntry[] = []
    for (const line of rest.split('\n')) {
      if (line.length === 0) continue
      const parsed = parseDiffstatLine(line)
      /* v8 ignore next -- parseDiffstatLine only returns null on malformed --numstat output, which git does not produce. */
      if (parsed === null) continue
      diffstat.push(parsed)
    }
    const commit: CommitDetail = { sha, subject, author, iso_date, rel_date, files: diffstat.length }
    if (includeDiffstat) commit.diffstat = diffstat
    commits.push(commit)
  }
  return commits
}

const parseStatusZ = (out: string): WorkingTreeReport => {
  const modified: WorkingTreeEntry[] = []
  let modifiedCount = 0
  let untrackedCount = 0
  const tokens = out.split('\0')
  let i = 0
  while (i < tokens.length) {
    const entry = tokens[i] as string
    // Trailing token after the final NUL is empty (length 0); partial entries (1–2 chars) are defensive.
    if (entry.length < 3) {
      i++
      continue
    }
    const status = entry.slice(0, 2)
    const filePath = entry.slice(3)
    modified.push({ status, path: filePath })
    if (status === '??') untrackedCount++
    else modifiedCount++
    // Rename entries are followed by a second NUL-terminated origin path; consume it so we don't treat it as its own entry. (Copy detection is off in default `git status --porcelain`, so we only handle 'R'.)
    if (status[0] === 'R') i += 2
    else i++
  }
  return { modified, summary: { modified: modifiedCount, untracked: untrackedCount } }
}

const UNBORN_HEAD = /does not have any commits yet|bad default revision 'HEAD'/i

const stderrText = (err: unknown): string => {
  const v = (err as { stderr?: unknown } | null)?.stderr
  /* v8 ignore next -- execFile rejections always have a string `stderr`; defensive coercion for unexpected error shapes. */
  return typeof v === 'string' ? v : ''
}

const runGitDetail = async (repo: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileP('git', ['--no-optional-locks', '-C', repo, ...args], {
    timeout: DETAIL_TIMEOUT_MS,
    maxBuffer: DETAIL_MAX_BUFFER
  })
  return stdout
}

/**
 * Return commit history + working-tree status for a single repo identified by
 * an absolute path. The caller is responsible for ensuring `absPath` has been
 * revalidated against `safeRoots` — but we re-check here as defence in depth.
 * No fetching, no diff content, no cross-repo work.
 */
export const repoDetail = async (safeRoots: readonly string[], absPath: string, opts: RepoDetailOptions): Promise<RepoDetailResult> => {
  const fetched_at = new Date().toISOString()
  const { resolved, containingRoot } = await resolveAndLocateAgainstSafeRoots(absPath, safeRoots)
  const relPath = path.relative(containingRoot, resolved).split(path.sep).join('/')

  const requested = Math.min(Math.max(1, Math.trunc(opts.commits)), MAX_COMMITS)
  const logArgs = ['log', `-n${requested}`, `--pretty=format:${COMMIT_SEP}%h${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%cI${FIELD_SEP}%ar`, '--numstat']

  let commits: CommitDetail[] = []
  let error: string | undefined
  try {
    const logOut = await runGitDetail(resolved, logArgs)
    commits = parseLogOutput(logOut, opts.include_diffstat)
  } catch (err) {
    if (UNBORN_HEAD.test(stderrText(err))) commits = []
    else error = `git log failed: ${errMessage(err)}`
  }

  let working_tree: WorkingTreeReport = { modified: [], summary: { modified: 0, untracked: 0 } }
  try {
    const statusOut = await runGitDetail(resolved, ['status', '--porcelain=v1', '-z'])
    working_tree = parseStatusZ(statusOut)
  } catch (err) {
    /* v8 ignore next 2 -- `git status` only fails on a severely damaged repo; the `git log` failure already covers the user-facing error envelope. */
    if (!error) error = `git status failed: ${errMessage(err)}`
  }

  const result: RepoDetailResult = { abs_path: resolved, path: relPath, fetched_at, commits, working_tree }
  if (error) result.error = error
  return result
}
