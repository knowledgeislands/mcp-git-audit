import * as os from 'node:os'
import * as path from 'node:path'

const expandHome = (p: string): string => {
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

try {
  process.loadEnvFile(`./.env.${process.env.NODE_ENV}`)
} catch {
  // no .env present — that's fine
}

// Default to the user's home dir when the env var is unset or empty.
// Home is a sensible upper bound — the user already owns everything in it, and
// it keeps the tool from reaching into /etc, /opt, or other system trees.
const DEFAULT_SAFE_ROOTS = '~'

const parseSafeRoots = (raw: string | undefined): readonly string[] => {
  const source = raw === undefined || raw.trim() === '' ? DEFAULT_SAFE_ROOTS : raw
  const parts = source
    .split(':')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) throw new Error('MCP_GIT_AUDIT_SAFE_ROOTS must contain at least one path')
  const resolved = parts.map((p) => path.resolve(expandHome(p)))
  return Object.freeze([...new Set(resolved)])
}

export const SAFE_ROOTS: readonly string[] = parseSafeRoots(process.env.MCP_GIT_AUDIT_SAFE_ROOTS)

export const AUDIT_LOG_PATH: string = path.resolve(expandHome(process.env.MCP_GIT_AUDIT_AUDIT_LOG_PATH ?? path.join(os.homedir(), '.local', 'state', 'mcp-git-audit', 'audit.jsonl')))

/**
 * Scope of tool invocations to record. mcp-git-audit is read-only, so the
 * `writes` default never produces any output here; flip to `all` to record
 * every invocation, or `off` to fully disable.
 */
export type AuditLogMode = 'off' | 'writes' | 'all'

const parseAuditLogMode = (raw: string | undefined): AuditLogMode => {
  const v = raw?.trim().toLowerCase()
  if (v === undefined || v === '') return 'writes'
  if (v === 'off' || v === 'writes' || v === 'all') return v
  throw new Error(`Invalid MCP_GIT_AUDIT_AUDIT_LOG="${raw}" — expected one of: off, writes, all.`)
}

export const AUDIT_LOG_MODE: AuditLogMode = parseAuditLogMode(process.env.MCP_GIT_AUDIT_AUDIT_LOG)

/**
 * Size-based audit-log rotation. After each append, if `audit.jsonl` exceeds
 * MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES (default 10 MiB), it's renamed to
 * `audit.jsonl.1` and older rotations shift up. MCP_GIT_AUDIT_AUDIT_LOG_KEEP
 * (default 5) controls how many rotated files survive. Set MAX_BYTES=0 to
 * disable rotation.
 */
const parseNonNegativeInt = (raw: string | undefined, fallback: number, varName: string): number => {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid ${varName}="${raw}" — expected a non-negative integer.`)
  }
  return n
}
export const AUDIT_LOG_MAX_BYTES: number = parseNonNegativeInt(process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES, 10 * 1024 * 1024, 'MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES')
export const AUDIT_LOG_KEEP: number = parseNonNegativeInt(process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP, 5, 'MCP_GIT_AUDIT_AUDIT_LOG_KEEP')
