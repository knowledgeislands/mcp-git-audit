import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READ_ONLY } from './annotations.js'

describe('levelFromAnnotations / makeAccessGatedRegister (mcp-git-audit)', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.MCP_GIT_AUDIT_ACCESS_LEVEL
  })

  afterEach(() => {
    delete process.env.MCP_GIT_AUDIT_ACCESS_LEVEL
  })

  const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const
  const ADDITIVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const

  it('maps READ_ONLY to read', async () => {
    const { levelFromAnnotations } = await import('./access-level.js')
    expect(levelFromAnnotations(READ_ONLY)).toBe('read')
  })

  it('maps destructiveHint:true to destructive', async () => {
    const { levelFromAnnotations } = await import('./access-level.js')
    expect(levelFromAnnotations(DESTRUCTIVE)).toBe('destructive')
  })

  it('maps explicit non-destructive write annotations to write', async () => {
    const { levelFromAnnotations } = await import('./access-level.js')
    expect(levelFromAnnotations(ADDITIVE)).toBe('write')
  })

  it('defaults to destructive (fail-safe) for missing annotations', async () => {
    const { levelFromAnnotations } = await import('./access-level.js')
    expect(levelFromAnnotations(undefined)).toBe('destructive')
  })

  it('rejects unknown MCP_GIT_AUDIT_ACCESS_LEVEL values at config load', async () => {
    process.env.MCP_GIT_AUDIT_ACCESS_LEVEL = 'admin'
    await expect(import('../config.js')).rejects.toThrow(/Invalid MCP_GIT_AUDIT_ACCESS_LEVEL="admin"/)
  })

  it('registers only read tools by default (gate=read)', async () => {
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: string[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: unknown) => calls.push(name) }
    const gated = makeAccessGatedRegister(stub as unknown as Parameters<typeof makeAccessGatedRegister>[0])
    gated('git_repos_scan', { title: 't', description: 'd', annotations: READ_ONLY } as never, (async () => ({ content: [] })) as never)
    gated('hypothetical_writer', { title: 't', description: 'd', annotations: ADDITIVE } as never, (async () => ({ content: [] })) as never)
    gated('hypothetical_destructive', { title: 't', description: 'd', annotations: DESTRUCTIVE } as never, (async () => ({ content: [] })) as never)
    expect(calls).toEqual(['git_repos_scan'])
  })

  it('registers read + write but not destructive when gate=write', async () => {
    process.env.MCP_GIT_AUDIT_ACCESS_LEVEL = 'write'
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: string[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: unknown) => calls.push(name) }
    const gated = makeAccessGatedRegister(stub as unknown as Parameters<typeof makeAccessGatedRegister>[0])
    gated('git_repos_scan', { title: 't', description: 'd', annotations: READ_ONLY } as never, (async () => ({ content: [] })) as never)
    gated('hypothetical_writer', { title: 't', description: 'd', annotations: ADDITIVE } as never, (async () => ({ content: [] })) as never)
    gated('hypothetical_destructive', { title: 't', description: 'd', annotations: DESTRUCTIVE } as never, (async () => ({ content: [] })) as never)
    expect(calls).toEqual(['git_repos_scan', 'hypothetical_writer'])
  })

  it('registers every level when gate=destructive', async () => {
    process.env.MCP_GIT_AUDIT_ACCESS_LEVEL = 'destructive'
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: string[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: unknown) => calls.push(name) }
    const gated = makeAccessGatedRegister(stub as unknown as Parameters<typeof makeAccessGatedRegister>[0])
    gated('git_repos_scan', { title: 't', description: 'd', annotations: READ_ONLY } as never, (async () => ({ content: [] })) as never)
    gated('hypothetical_writer', { title: 't', description: 'd', annotations: ADDITIVE } as never, (async () => ({ content: [] })) as never)
    gated('hypothetical_destructive', { title: 't', description: 'd', annotations: DESTRUCTIVE } as never, (async () => ({ content: [] })) as never)
    expect(calls).toEqual(['git_repos_scan', 'hypothetical_writer', 'hypothetical_destructive'])
  })

  it('treats an unannotated tool as destructive (fail-safe — skipped under default gate=read)', async () => {
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: string[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: unknown) => calls.push(name) }
    const gated = makeAccessGatedRegister(stub as unknown as Parameters<typeof makeAccessGatedRegister>[0])
    gated('unannotated_tool', { title: 't', description: 'd' } as never, (async () => ({ content: [] })) as never)
    expect(calls).toEqual([])
  })
})
