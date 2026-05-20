import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'

const execFileP = promisify(execFile)

/**
 * Timeout for local-only git operations (no network I/O): config reads, ref
 * writes, working-tree inspection. Matches the cap used by audit.ts/detail.ts.
 */
export const GIT_LOCAL_TIMEOUT_MS = 8000

/**
 * Timeout for network-bound git operations (fetch / pull / push). Larger than
 * the local cap because remotes can be slow, but still bounded so a stalled
 * remote can't pin the MCP server forever.
 */
export const GIT_NETWORK_TIMEOUT_MS = 60_000

const GIT_MAX_BUFFER = 8 * 1024 * 1024

export interface GitRunResult {
  stdout: string
  stderr: string
}

/**
 * Run `git <args>` inside `repo`, always with `--no-optional-locks` and never
 * via a shell. Captures both stdout and stderr — fetch/pull/push report
 * progress + the actual update lines on stderr, so callers need it.
 *
 * Non-zero exit codes throw; the caller is expected to map them to a
 * structured result. Use `tryRunGitCapture` when failure is expected.
 */
export const runGitCapture = async (repo: string, args: string[], timeoutMs: number): Promise<GitRunResult> => {
  const { stdout, stderr } = await execFileP('git', ['--no-optional-locks', '-C', repo, ...args], {
    timeout: timeoutMs,
    maxBuffer: GIT_MAX_BUFFER,
    env: {
      ...process.env,
      // Disable interactive credential prompts — the server runs under stdio
      // and has no terminal. Without this, an auth-required remote can stall
      // until the timeout fires.
      GIT_TERMINAL_PROMPT: '0'
    }
  })
  return { stdout, stderr }
}

/**
 * Identifier patterns for arguments that are passed to git as positional
 * parameters. Tightened beyond what git itself accepts so user input can never
 * look like an option (`-x`) or escape the repo (`..`).
 */
export const REMOTE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/

// Branch names allow `/` (e.g. `feature/foo`); reject leading `-`, `.`, `/`
// and any `..` sequence (matches git's own check-ref-format basics).
export const BRANCH_NAME_RE = /^(?![-./])(?!.*\.\.)(?!.*\/$)[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/

/**
 * Remote URL validator. Rejects anything that starts with `-` (option
 * injection) and bounds the length. The exact transport (ssh, https, git@,
 * file://, absolute path) is left to git — we only enforce shape.
 */
export const REMOTE_URL_RE = /^(?!-)[^\s\0\r\n]{1,2048}$/

export const remoteNameSchema = z.string().regex(REMOTE_NAME_RE, 'remote name must be 1–100 chars, [A-Za-z0-9_.-], not starting with "-" or "."')

export const branchNameSchema = z.string().regex(BRANCH_NAME_RE, 'branch name must be a valid git ref segment ([A-Za-z0-9_./-], no leading "-/.", no ".." sequence, no trailing "/")')

export const remoteUrlSchema = z.string().regex(REMOTE_URL_RE, 'url must be 1–2048 chars and must not start with "-" or contain whitespace/control chars')
