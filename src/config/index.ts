/**
 * Configuration loading. `loadConfig()` reads the environment (optionally
 * hydrated from the package's `.env*` files) into a plain `Config` value that is
 * passed explicitly into every main call — so the same code runs as an MCP
 * server or from a standalone script. There is NO module-level config
 * singleton: nothing here is read at import time.
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const expandHome = (p: string): string => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p)

/**
 * Package root, resolved from this module's own URL — NOT `process.cwd()`,
 * which is wherever the MCP host happened to launch `node dist/mcp-server/...`
 * from. Both layouts put this file two levels below the root
 * (`dist/config/index.js` and `src/config/index.ts`), so `../..` is correct
 * whether built or run from source.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Hydrate `process.env` from the package's `.env*` files, mirroring the set and
 * precedence Bun auto-loads (highest first: `.env.local`, then
 * `.env.${NODE_ENV}` if NODE_ENV is set, then `.env`). `process.loadEnvFile`
 * never overwrites a key already present in `process.env`, so loading
 * highest-precedence first means earlier files win — and any value injected by
 * the host (e.g. the MCP client's `env` block) beats every file. Missing files
 * are skipped silently; under Bun this is largely redundant with its own
 * auto-load, which is fine.
 */
const hydrateEnvFromFiles = (): void => {
  const files = ['.env.local']
  if (process.env.NODE_ENV) files.push(`.env.${process.env.NODE_ENV}`)
  files.push('.env')
  for (const file of files) {
    try {
      process.loadEnvFile(path.join(PACKAGE_ROOT, file))
    } catch {
      // File absent or unreadable — skip; the value may come from the host env.
    }
  }
}

/**
 * Single ordinal access level — matches the sibling MCPs (mcp-kb-fs, mcp-gmail,
 * mcp-m365, mcp-claude-housekeeping). Each level implies all lower ones:
 *   `read`        — only readOnly tools registered.
 *   `write`       — readOnly + non-destructive mutations.
 *   `destructive` — everything, including delete / overwrite.
 *
 * The gate uses ACCESS_LEVEL_RANK for ordinal comparison; a tool registers when
 * its derived level ≤ the configured level.
 */
export type AccessLevel = 'read' | 'write' | 'destructive'
export const ACCESS_LEVELS: readonly AccessLevel[] = ['read', 'write', 'destructive'] as const
export const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = { read: 1, write: 2, destructive: 3 }

/**
 * Scope of tool invocations to record. mcp-git-audit is read-only by default,
 * so the `writes` default never produces any output for read tools; flip to
 * `all` to record every invocation, or `off` to fully disable.
 */
export type AuditLogMode = 'off' | 'writes' | 'all'

export interface Config {
  /**
   * Resolved, deduplicated, frozen list of absolute paths the tool may audit.
   * Any `root`/`abs_path` argument must equal or live inside one of these.
   */
  safeRoots: readonly string[]
  accessLevel: AccessLevel
  auditLogMode: AuditLogMode
  auditLogPath: string
  auditLogMaxBytes: number
  auditLogKeep: number
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

const parseAccessLevel = (raw: string | undefined): AccessLevel => {
  const v = raw?.trim()
  if (v === undefined || v === '') return 'read'
  if ((ACCESS_LEVELS as readonly string[]).includes(v)) return v as AccessLevel
  throw new Error(`Invalid MCP_GIT_AUDIT_ACCESS_LEVEL="${raw}". Allowed: ${ACCESS_LEVELS.join(', ')}`)
}

const parseAuditLogMode = (raw: string | undefined): AuditLogMode => {
  const v = raw?.trim().toLowerCase()
  if (v === undefined || v === '') return 'writes'
  if (v === 'off' || v === 'writes' || v === 'all') return v
  throw new Error(`Invalid MCP_GIT_AUDIT_AUDIT_LOG="${raw}" — expected one of: off, writes, all.`)
}

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

/**
 * Load configuration from `env` (defaults to `process.env`, after attempting to
 * hydrate it from the package's `.env*` files). Throws if a var is malformed.
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  hydrateEnvFromFiles()

  return {
    safeRoots: parseSafeRoots(env.MCP_GIT_AUDIT_SAFE_ROOTS),
    accessLevel: parseAccessLevel(env.MCP_GIT_AUDIT_ACCESS_LEVEL),
    auditLogMode: parseAuditLogMode(env.MCP_GIT_AUDIT_AUDIT_LOG),
    auditLogPath: path.resolve(expandHome(env.MCP_GIT_AUDIT_AUDIT_LOG_PATH ?? path.join(os.homedir(), '.local', 'state', 'mcp-git-audit', 'audit.jsonl'))),
    auditLogMaxBytes: parseNonNegativeInt(env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES, 10 * 1024 * 1024, 'MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES'),
    auditLogKeep: parseNonNegativeInt(env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP, 5, 'MCP_GIT_AUDIT_AUDIT_LOG_KEEP')
  }
}
