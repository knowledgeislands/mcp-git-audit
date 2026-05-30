import { errMessage } from '../../utils/errors.js'
import { GIT_LOCAL_TIMEOUT_MS, runGitCapture } from '../../utils/git-exec.js'
import { resolveAgainstSafeRoots } from '../../utils/paths.js'

/**
 * Hard ceiling on `max_lines`. The schema caps user input at 2000, but the
 * core defends in depth so a direct caller can't ask for an unbounded diff.
 */
export const DIFF_MAX_LINES_CEILING = 2000

export interface DiffFileEntry {
  path: string
  status: string
  additions: number
  deletions: number
  diff: string | null
  truncated: boolean
}

export interface DiffResult {
  abs_path: string
  staged: boolean
  fetched_at: string
  total_additions: number
  total_deletions: number
  truncated: boolean
  files: DiffFileEntry[]
}

export interface DiffOptions {
  staged: boolean
  paths?: string[]
  max_lines: number
}

interface NumstatEntry {
  additions: number
  deletions: number
  path: string
}

interface NameStatusEntry {
  status: string
  path: string
}

const NUMSTAT_LINE = /^(\d+|-)\t(\d+|-)\t(.*)$/

const parseNumstatZ = (out: string): NumstatEntry[] => {
  // `git diff --numstat -z` formats each record as either:
  //   <additions>\t<deletions>\t<path>\0                       (non-rename)
  //   <additions>\t<deletions>\t\0<old_path>\0<new_path>\0     (rename)
  // We split on NUL and walk forward, consuming an extra two tokens for
  // renames. Binary files report "-" for both counts; we coerce to 0.
  const tokens = out.split('\0')
  const entries: NumstatEntry[] = []
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i] as string
    if (tok.length === 0) {
      i++
      continue
    }
    const m = NUMSTAT_LINE.exec(tok)
    /* v8 ignore next 4 -- `git diff --numstat` always matches NUMSTAT_LINE; defensive guard against future format drift. */
    if (!m) {
      i++
      continue
    }
    const additions = m[1] === '-' ? 0 : Number.parseInt(m[1] as string, 10)
    const deletions = m[2] === '-' ? 0 : Number.parseInt(m[2] as string, 10)
    const rest = m[3] as string
    if (rest === '') {
      // Rename: next two tokens are <old>\0<new>.
      /* v8 ignore next -- `git diff --numstat -z` always emits both rename paths; the `?? ''` is defence in depth. */
      const newPath = (tokens[i + 2] ?? '') as string
      entries.push({ additions, deletions, path: newPath })
      i += 3
    } else {
      entries.push({ additions, deletions, path: rest })
      i++
    }
  }
  return entries
}

const RENAME_OR_COPY_STATUS_RE = /^[RC]/

const parseNameStatusZ = (out: string): NameStatusEntry[] => {
  // `git diff --name-status -z` formats each record as either:
  //   <STATUS>\0<path>                       (non-rename)
  //   R<score>\0<old_path>\0<new_path>       (rename — also C<score> for copy)
  const tokens = out.split('\0').filter((t) => t.length > 0)
  const entries: NameStatusEntry[] = []
  let i = 0
  while (i < tokens.length) {
    const status = tokens[i] as string
    if (RENAME_OR_COPY_STATUS_RE.test(status)) {
      // Rename/copy: skip the old path, key by the new path.
      /* v8 ignore next -- `git diff --name-status -z` always emits both rename/copy paths; defensive fallback. */
      const newPath = (tokens[i + 2] ?? '') as string
      entries.push({ status, path: newPath })
      i += 3
    } else {
      /* v8 ignore next -- non-rename status records always carry a path token; defensive fallback. */
      const filePath = (tokens[i + 1] ?? '') as string
      entries.push({ status, path: filePath })
      i += 2
    }
  }
  return entries
}

const DIFF_GIT_PREFIX = 'diff --git '

const splitDiffPerFile = (out: string): string[] => {
  // `git diff` (without -z) emits one or more "diff --git a/... b/..." chunks
  // back-to-back. Split by the line marker; everything before the first such
  // line is preamble (empty for plain diff output, but we drop it defensively).
  if (out.length === 0) return []
  const parts = out.split(/(?=^diff --git )/m)
  return parts.filter((p) => p.startsWith(DIFF_GIT_PREFIX))
}

const countLines = (s: string): number => {
  // `git diff` chunks always end with a newline, so counting newlines counts
  // the lines emitted by git verbatim. An empty string yields 0 — which is
  // the invariant we want for "no body".
  let n = 0
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) n++
  }
  return n
}

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

/**
 * Return structured diff data for unstaged or staged changes. Read-only — no
 * mutation. Internally makes three `git diff` calls (numstat, name-status,
 * unified) so the result can carry per-file counts, status letters, AND patch
 * text without re-implementing rename-aware path parsing on top of an
 * interleaved `-p --numstat` stream.
 *
 * `max_lines` is a budget across all files. Once a file's diff would exceed
 * the remaining budget, its `diff` field is set to `null` and `truncated: true`
 * is recorded on that file entry; subsequent files are likewise null+truncated.
 * The top-level `truncated` is the disjunction over file entries.
 */
export const diffRepo = async (safeRoots: readonly string[], absPath: string, opts: DiffOptions): Promise<DiffResult> => {
  const resolved = await resolveAgainstSafeRoots(absPath, safeRoots)
  const paths = validateRelPaths(opts.paths)
  const maxLines = Math.min(Math.max(1, Math.trunc(opts.max_lines)), DIFF_MAX_LINES_CEILING)
  const fetched_at = new Date().toISOString()

  const baseArgs: string[] = ['diff']
  if (opts.staged) baseArgs.push('--cached')

  const pathArgs: string[] = paths.length > 0 ? ['--', ...paths] : []

  let numstatOut: string
  let nameStatusOut: string
  let diffOut: string
  try {
    ;[numstatOut, nameStatusOut, diffOut] = await Promise.all([
      runGitCapture(resolved, [...baseArgs, '--numstat', '-z', ...pathArgs], GIT_LOCAL_TIMEOUT_MS).then((r) => r.stdout),
      runGitCapture(resolved, [...baseArgs, '--name-status', '-z', ...pathArgs], GIT_LOCAL_TIMEOUT_MS).then((r) => r.stdout),
      runGitCapture(resolved, [...baseArgs, ...pathArgs], GIT_LOCAL_TIMEOUT_MS).then((r) => r.stdout)
    ])
  } catch (err) {
    throw new Error(`git diff failed: ${errMessage(err)}`)
  }

  const numstat = parseNumstatZ(numstatOut)
  const nameStatus = parseNameStatusZ(nameStatusOut)
  const diffChunks = splitDiffPerFile(diffOut)

  const statusByPath = new Map<string, string>()
  for (const ns of nameStatus) statusByPath.set(ns.path, ns.status)

  const files: DiffFileEntry[] = []
  let total_additions = 0
  let total_deletions = 0
  let anyTruncated = false
  let usedLines = 0

  for (let idx = 0; idx < numstat.length; idx++) {
    const n = numstat[idx] as NumstatEntry
    /* v8 ignore next -- statusByPath always has an entry for every numstat path because git emits both lists from the same diff machinery; the `?? '?'` is defence in depth. */
    const status = statusByPath.get(n.path) ?? '?'
    // Chunks come from `git diff` in the same file order as numstat — pair by
    // index. git emits a chunk per numstat entry (binary files included), so
    // a missing chunk only happens under format drift; v8 ignore covers it.
    /* v8 ignore next -- numstat and diff body always have the same per-file length; defensive fallback. */
    const chunk = (diffChunks[idx] ?? '') as string
    total_additions += n.additions
    total_deletions += n.deletions
    const lines = countLines(chunk)
    let diffText: string | null = chunk
    let truncated = false
    if (usedLines + lines > maxLines) {
      diffText = null
      truncated = true
    } else {
      usedLines += lines
    }
    if (truncated) anyTruncated = true
    files.push({ path: n.path, status, additions: n.additions, deletions: n.deletions, diff: diffText, truncated })
  }

  return {
    abs_path: resolved,
    staged: opts.staged,
    fetched_at,
    total_additions,
    total_deletions,
    truncated: anyTruncated,
    files
  }
}
