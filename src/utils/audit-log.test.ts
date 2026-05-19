import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('appendAuditEvent / withAuditLog (mcp-git-audit)', () => {
  const tmpDir = path.join(os.tmpdir(), 'mcp-git-audit-audit-log-tests', `run-${process.pid}-${Date.now()}`)
  const logPath = path.join(tmpDir, 'audit.jsonl')

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    vi.resetModules()
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_PATH = logPath
    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_PATH
    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG
  })

  // Default mode is `writes`, but this server has only read-role tools — so the
  // default scope produces zero output. Effectively logging-off until the user
  // opts in with `=all`.
  it('returns the handler verbatim for read-role tools by default (writes mode → no read logging)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const handler = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('git_repos_scan', 'read', handler)).toBe(handler)
    await handler({})
    await new Promise((r) => setTimeout(r, 20))
    await expect(fs.access(logPath)).rejects.toThrow()
  })

  it('logs read-role tools when MCP_GIT_AUDIT_AUDIT_LOG=all', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ root: '/repos' })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.server).toBe('mcp-git-audit')
    expect(event.tool).toBe('git_repos_scan')
    expect(event.role).toBe('read')
    expect(event.ok).toBe(true)
    expect(event.args).toEqual({ root: '/repos' })
  })

  it('records ok:false when isError:true', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ isError: true, content: [{ type: 'text', text: 'bad root' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('bad root')
  })

  it('records ok:false when the handler throws', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => {
      throw new Error('kaboom')
    })
    await expect(wrapped({})).rejects.toThrow(/kaboom/)
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('kaboom')
  })

  it('skips logging entirely when MCP_GIT_AUDIT_AUDIT_LOG=off', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'off'
    const { withAuditLog } = await import('./audit-log.js')
    const readHandler = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('git_repos_scan', 'read', readHandler)).toBe(readHandler)
    await readHandler({})
    await new Promise((r) => setTimeout(r, 20))
    await expect(fs.access(logPath)).rejects.toThrow()
  })

  it('rejects unknown MCP_GIT_AUDIT_AUDIT_LOG values at config load', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'sometimes'
    await expect(import('./audit-log.js')).rejects.toThrow(/Invalid MCP_GIT_AUDIT_AUDIT_LOG/)
  })

  it('creates the audit log with mode 0o600 and chmods an existing 0o644 log down to 0o600', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(logPath, '', { mode: 0o644 })
    expect(((await fs.stat(logPath)).mode & 0o777).toString(8)).toBe('644')

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))

    const mode = (await fs.stat(logPath)).mode & 0o777
    expect(mode.toString(8)).toBe('600')
  })

  it('truncates oversized argument payloads with a _truncated marker', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ blob: 'x'.repeat(8000) })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.args._truncated).toBe(true)
    expect(typeof event.args.preview).toBe('string')
  })
})
