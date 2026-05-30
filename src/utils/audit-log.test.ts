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

  // Default mode is `writes`, but this server has only read-level tools today —
  // so the default scope produces zero output. Effectively logging-off until
  // the user opts in with `=all`.
  it('returns the handler verbatim for read-level tools by default (writes mode → no read logging)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const handler = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('git_repos_scan', 'read', handler)).toBe(handler)
    await handler({})
    await new Promise((r) => setTimeout(r, 20))
    await expect(fs.access(logPath)).rejects.toThrow()
  })

  it('logs read-level tools when MCP_GIT_AUDIT_AUDIT_LOG=all', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ root: '/repos' })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.server).toBe('mcp-git-audit')
    expect(event.tool).toBe('git_repos_scan')
    expect(event.level).toBe('read')
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

  it('stringifies a non-Error thrown value for the audit record', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => {
      // Deliberately throwing a non-Error value to exercise the String(err) branch.
      return Promise.reject('plain string failure')
    })
    await expect(wrapped({})).rejects.toBe('plain string failure')
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('plain string failure')
  })

  it('records no error text when an isError result has non-array content', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ isError: true, content: 'oops' }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBeUndefined()
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

  it('only chmods once per process (skips the chmod on the second append)', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    // First append sets chmodEnsured=true; the second takes the `!chmodEnsured` false branch.
    await wrapped({ n: 1 })
    await new Promise((r) => setTimeout(r, 20))
    await wrapped({ n: 2 })
    await new Promise((r) => setTimeout(r, 20))
    const lines = (await fs.readFile(logPath, 'utf-8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect((await fs.stat(logPath)).mode & 0o777).toBe(0o600)
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

  it('swallows write failures (unwritable log path) without throwing', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    // Point the log at a path whose parent is a regular file, so mkdir/appendFile
    // fail with ENOTDIR; the outer catch logs to stderr and the call still resolves.
    const blockingFile = path.join(tmpDir, 'not-a-dir')
    await fs.writeFile(blockingFile, 'x', 'utf-8')
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_PATH = path.join(blockingFile, 'nested', 'audit.jsonl')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await expect(wrapped({})).resolves.toBeDefined()
    await new Promise((r) => setTimeout(r, 20))

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[audit-log] failed to write'))
    errSpy.mockRestore()
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_PATH = logPath
  })

  it('rotates the live log to .1 and shifts existing rotations when over the size cap', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES = '10'
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP = '2'
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    // Pre-seed an oversized live log plus an existing .1 rotation so the shift
    // path (.1 -> .2) and the live -> .1 rename both execute.
    await fs.writeFile(logPath, `${'a'.repeat(50)}\n`, { mode: 0o600 })
    await fs.writeFile(`${logPath}.1`, 'old\n', { mode: 0o600 })

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 30))

    // Append happens first (to the live log), then rotation renames live -> .1.
    // The prior .1 was shifted to .2; the oversized-plus-new-event live log became .1.
    expect((await fs.readFile(`${logPath}.2`, 'utf-8')).trim()).toBe('old')
    expect((await fs.readFile(`${logPath}.1`, 'utf-8')).startsWith('a'.repeat(50))).toBe(true)
    // After the rename there is no live log until the next append.
    await expect(fs.access(logPath)).rejects.toThrow()

    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES
    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP
  })

  it('truncates the live log in place when KEEP=0 and over the cap', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES = '10'
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP = '0'
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(logPath, `${'b'.repeat(50)}\n`, { mode: 0o600 })

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 30))

    // KEEP=0: rotation removes the oversized live log outright (no .1 kept).
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()
    await expect(fs.access(logPath)).rejects.toThrow()

    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES
    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP
  })

  it('does not rotate when MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES=0 (rotation disabled)', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES = '0'
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(logPath, `${'c'.repeat(50)}\n`, { mode: 0o600 })

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 30))

    // No rotation: original line is retained and the new event is appended.
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()
    expect((await fs.readFile(logPath, 'utf-8')).trim().split('\n').length).toBeGreaterThanOrEqual(2)

    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES
  })

  it('skips rotation when the live log does not yet exist (stat fails)', async () => {
    // mkdir+append create the log fresh inside appendAuditEvent; at the moment
    // rotateIfNeeded first runs there is no oversized predecessor, exercising the
    // stat-then-return-early path without error.
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES = '1048576'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))
    expect((await fs.readFile(logPath, 'utf-8')).trim().split('\n')).toHaveLength(1)
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()

    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES
  })

  it('swallows rotation failures (rename target unwritable) without throwing', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG = 'all'
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES = '10'
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP = '1'
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(logPath, `${'d'.repeat(50)}\n`, { mode: 0o600 })
    // Make `.1` a non-empty directory so `fs.rm(..., {force:true})` then
    // `fs.rename(live, .1)` fails — the catch logs to stderr and leaves the
    // live file intact rather than throwing.
    await fs.mkdir(`${logPath}.1`, { recursive: true })
    await fs.writeFile(path.join(`${logPath}.1`, 'blocker'), 'x', 'utf-8')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('git_repos_scan', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await expect(wrapped({})).resolves.toBeDefined()
    await new Promise((r) => setTimeout(r, 30))

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[audit-log] rotation failed'))
    errSpy.mockRestore()

    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES
    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP
  })
})
