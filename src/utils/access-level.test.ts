import { describe, expect, it } from 'vitest'
import type { AccessLevel } from '../config/index.js'
import { levelFromAnnotations, makeAccessGatedRegister } from './access-level.js'
import { READ_ONLY } from './annotations.js'
import type { AuditConfig } from './audit-log.js'

describe('levelFromAnnotations / makeAccessGatedRegister (mcp-git-audit)', () => {
  const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const

  // Audit is off in these tests — we only assert the access gate, not logging.
  const audit: AuditConfig = { mode: 'off', path: '/dev/null', maxBytes: 0, keep: 0 }

  const gateAt = (accessLevel: AccessLevel) => {
    const calls: string[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: unknown) => calls.push(name) }
    const gated = makeAccessGatedRegister(stub as unknown as Parameters<typeof makeAccessGatedRegister>[0], accessLevel, audit)
    return { calls, gated }
  }

  it('maps READ_ONLY to read', () => {
    expect(levelFromAnnotations(READ_ONLY)).toBe('read')
  })

  it('maps destructiveHint:true to destructive', () => {
    expect(levelFromAnnotations(DESTRUCTIVE)).toBe('destructive')
  })

  it('maps explicit non-destructive write annotations to write', () => {
    expect(levelFromAnnotations(WRITE)).toBe('write')
  })

  it('defaults to destructive (fail-safe) for missing annotations', () => {
    expect(levelFromAnnotations(undefined)).toBe('destructive')
  })

  it('registers only read tools by default (gate=read)', () => {
    const { calls, gated } = gateAt('read')
    gated('git_repos_scan', { title: 't', description: 'd', annotations: READ_ONLY } as never, (async () => ({ content: [] })) as never)
    gated('hypothetical_writer', { title: 't', description: 'd', annotations: WRITE } as never, (async () => ({ content: [] })) as never)
    gated(
      'hypothetical_destructive',
      { title: 't', description: 'd', annotations: DESTRUCTIVE } as never,
      (async () => ({ content: [] })) as never
    )
    expect(calls).toEqual(['git_repos_scan'])
  })

  it('registers read + write but not destructive when gate=write', () => {
    const { calls, gated } = gateAt('write')
    gated('git_repos_scan', { title: 't', description: 'd', annotations: READ_ONLY } as never, (async () => ({ content: [] })) as never)
    gated('hypothetical_writer', { title: 't', description: 'd', annotations: WRITE } as never, (async () => ({ content: [] })) as never)
    gated(
      'hypothetical_destructive',
      { title: 't', description: 'd', annotations: DESTRUCTIVE } as never,
      (async () => ({ content: [] })) as never
    )
    expect(calls).toEqual(['git_repos_scan', 'hypothetical_writer'])
  })

  it('registers every level when gate=destructive', () => {
    const { calls, gated } = gateAt('destructive')
    gated('git_repos_scan', { title: 't', description: 'd', annotations: READ_ONLY } as never, (async () => ({ content: [] })) as never)
    gated('hypothetical_writer', { title: 't', description: 'd', annotations: WRITE } as never, (async () => ({ content: [] })) as never)
    gated(
      'hypothetical_destructive',
      { title: 't', description: 'd', annotations: DESTRUCTIVE } as never,
      (async () => ({ content: [] })) as never
    )
    expect(calls).toEqual(['git_repos_scan', 'hypothetical_writer', 'hypothetical_destructive'])
  })

  it('treats an unannotated tool as destructive (fail-safe — skipped under default gate=read)', () => {
    const { calls, gated } = gateAt('read')
    gated('unannotated_tool', { title: 't', description: 'd' } as never, (async () => ({ content: [] })) as never)
    expect(calls).toEqual([])
  })
})
