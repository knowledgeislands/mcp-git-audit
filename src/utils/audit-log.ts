/**
 * Append-only JSONL audit log for tool invocations.
 *
 * mcp-git-audit has only read-only tools, so by default nothing is logged
 * (matches the convention of the sibling MCPs, where auditor tools are off
 * by default). Set MCP_GIT_AUDIT_AUDIT_LOG_ALL=1 to log every invocation.
 * Path is configurable via MCP_GIT_AUDIT_AUDIT_LOG_PATH; defaults to
 * `~/.local/state/mcp-git-audit/audit.jsonl`.
 *
 * Failures to write the audit line are swallowed (stderr only) — a broken log
 * must never prevent a tool call from completing.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AUDIT_LOG_ALL, AUDIT_LOG_PATH } from '../config.js'

export type Role = 'auditor' | 'cleaner'

export interface AuditEvent {
  ts: string
  server: string
  tool: string
  role: Role
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

export const appendAuditEvent = async (event: AuditEvent): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true })
    await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(event)}\n`, 'utf-8')
  } catch (err) {
    console.error(`[audit-log] failed to write: ${err instanceof Error ? err.message : String(err)}`)
  }
}

type ToolCallback = (...callbackArgs: unknown[]) => unknown | Promise<unknown>

const extractErrorText = (result: unknown): string | undefined => {
  const content = (result as { content?: { type: string; text: string }[] }).content
  if (!Array.isArray(content)) return undefined
  const first = content.find((c) => c.type === 'text')
  return first?.text
}

export const withAuditLog = (toolName: string, role: Role, callback: ToolCallback): ToolCallback => {
  if (role === 'auditor' && !AUDIT_LOG_ALL) return callback
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
        role,
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
        role,
        ok: false,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        args: sanitizeArgs(args)
      })
      throw err
    }
  }
}

type RegisterTool = McpServer['registerTool']

/**
 * Wrap `server.registerTool` so every registered tool's callback is decorated
 * with the audit logger. Role is inferred from `annotations.readOnlyHint`.
 */
export const makeAuditedRegister = (server: McpServer): RegisterTool => {
  return new Proxy(server.registerTool.bind(server) as RegisterTool, {
    apply(target, thisArg, args: Parameters<RegisterTool>) {
      const name = args[0]
      const config = args[1] as { annotations?: { readOnlyHint?: boolean } } | undefined
      const role: Role = config?.annotations?.readOnlyHint ? 'auditor' : 'cleaner'
      const wrappedArgs = [...args] as Parameters<RegisterTool>
      const callback = wrappedArgs[2] as ToolCallback
      wrappedArgs[2] = withAuditLog(name, role, callback) as (typeof wrappedArgs)[2]
      return Reflect.apply(target, thisArg, wrappedArgs)
    }
  })
}
