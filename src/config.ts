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
export const AUDIT_LOG_ALL: boolean = process.env.MCP_GIT_AUDIT_AUDIT_LOG_ALL === '1'
