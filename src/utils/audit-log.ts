/**
 * Append-only JSONL audit log for tool invocations.
 *
 * Scope is controlled by MCP_GIT_AUDIT_AUDIT_LOG: `off` (no logging), `writes`
 * (default — but mcp-git-audit has no non-read tools today, so nothing is
 * logged) or `all` (every invocation). Level is derived from each tool's MCP
 * annotations by `makeAccessGatedRegister`. Path is configurable via
 * MCP_GIT_AUDIT_AUDIT_LOG_PATH; defaults to `~/.local/state/mcp-git-audit/audit.jsonl`.
 *
 * Failures to write the audit line are swallowed (stderr only) — a broken log
 * must never prevent a tool call from completing.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { type AccessLevel, AUDIT_LOG_KEEP, AUDIT_LOG_MAX_BYTES, AUDIT_LOG_MODE, AUDIT_LOG_PATH } from '../config.js'
import { errMessage } from './errors.js'

export interface AuditEvent {
  ts: string
  server: string
  tool: string
  level: AccessLevel
  ok: boolean
  duration_ms: number
  error?: string
  args: unknown
}

const SERVER_NAME = 'mcp-git-audit'
const MAX_ARG_CHARS = 4096

const sanitizeArgs = (args: unknown): unknown => {
  const serialized = JSON.stringify(args)
  if (serialized.length > MAX_ARG_CHARS) {
    return { _truncated: true, preview: serialized.slice(0, MAX_ARG_CHARS) }
  }
  return args
}

// Once per process, chmod the log to 0o600 after the first successful append
// — covers logs created before this safeguard existed (which would otherwise
// keep 0o644). `appendFile`'s `mode` option only applies on creation.
let chmodEnsured = false

/**
 * If the live log is over the size cap, shift `.1` → `.2` → … → `.N` (dropping
 * the oldest) and rename the live file to `.1`. Mode `0o600` is preserved by
 * `fs.rename`. Best-effort: any failure logs to stderr and leaves the file in
 * place so the next append still succeeds.
 */
const rotateIfNeeded = async (): Promise<void> => {
  if (AUDIT_LOG_MAX_BYTES === 0) return
  let size: number
  try {
    size = (await fs.stat(AUDIT_LOG_PATH)).size
    /* v8 ignore start -- stat only fails if the live log vanishes between the append and this check (a race); skip rotation when it does. */
  } catch {
    return
    /* v8 ignore stop */
  }
  if (size <= AUDIT_LOG_MAX_BYTES) return
  try {
    if (AUDIT_LOG_KEEP > 0) {
      await fs.rm(`${AUDIT_LOG_PATH}.${AUDIT_LOG_KEEP}`, { force: true })
      for (let i = AUDIT_LOG_KEEP - 1; i >= 1; i--) {
        try {
          await fs.rename(`${AUDIT_LOG_PATH}.${i}`, `${AUDIT_LOG_PATH}.${i + 1}`)
        } catch {
          // missing slot — fine, rotation history may not be full yet
        }
      }
      await fs.rename(AUDIT_LOG_PATH, `${AUDIT_LOG_PATH}.1`)
    } else {
      await fs.rm(AUDIT_LOG_PATH, { force: true })
    }
  } catch (err) {
    console.error(`[audit-log] rotation failed: ${errMessage(err)}`)
  }
}

const writeAuditEvent = async (event: AuditEvent): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true })
    await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(event)}\n`, { encoding: 'utf-8', mode: 0o600 })
    if (!chmodEnsured) {
      try {
        await fs.chmod(AUDIT_LOG_PATH, 0o600)
      } catch {
        // best-effort — log may have been rotated/removed between write and chmod
      }
      chmodEnsured = true
    }
    await rotateIfNeeded()
  } catch (err) {
    console.error(`[audit-log] failed to write: ${errMessage(err)}`)
  }
}

// Serialize appends through a single chain so concurrent callers can't race on
// the append → stat → rotate sequence (two simultaneous rotations would have
// one `rename(live → .1)` lose with ENOENT). Each call awaits the prior one;
// errors are swallowed inside writeAuditEvent so the chain never rejects.
let auditQueue: Promise<void> = Promise.resolve()

export const appendAuditEvent = (event: AuditEvent): Promise<void> => {
  auditQueue = auditQueue.then(() => writeAuditEvent(event))
  return auditQueue
}

type ToolCallback = (...callbackArgs: unknown[]) => unknown | Promise<unknown>

const extractErrorText = (result: unknown): string | undefined => {
  const content = (result as { content?: { type: string; text: string }[] }).content
  if (!Array.isArray(content)) return undefined
  const first = content.find((c) => c.type === 'text')
  return first?.text
}

export const withAuditLog = (toolName: string, level: AccessLevel, callback: ToolCallback): ToolCallback => {
  if (AUDIT_LOG_MODE === 'off') return callback
  if (level === 'read' && AUDIT_LOG_MODE !== 'all') return callback
  return async (...callbackArgs: unknown[]) => {
    const start = Date.now()
    const args = callbackArgs[0]
    try {
      const result = await callback(...callbackArgs)
      const isError = typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
      const errText = isError ? extractErrorText(result) : undefined
      void appendAuditEvent({
        ts: new Date().toISOString(),
        server: SERVER_NAME,
        tool: toolName,
        level,
        ok: !isError,
        duration_ms: Date.now() - start,
        error: errText,
        args: sanitizeArgs(args)
      })
      return result
    } catch (err) {
      void appendAuditEvent({
        ts: new Date().toISOString(),
        server: SERVER_NAME,
        tool: toolName,
        level,
        ok: false,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        args: sanitizeArgs(args)
      })
      throw err
    }
  }
}
