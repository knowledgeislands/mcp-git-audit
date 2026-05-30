import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let saved: string | undefined

beforeEach(() => {
  saved = process.env.MCP_GIT_AUDIT_SAFE_ROOTS
  vi.resetModules()
})

afterEach(() => {
  if (saved === undefined) delete process.env.MCP_GIT_AUDIT_SAFE_ROOTS
  else process.env.MCP_GIT_AUDIT_SAFE_ROOTS = saved
})

describe('SAFE_ROOTS', () => {
  it('defaults to the user home directory when env var is unset', async () => {
    delete process.env.MCP_GIT_AUDIT_SAFE_ROOTS
    const { SAFE_ROOTS } = await import('./config.js')
    expect(SAFE_ROOTS).toEqual([os.homedir()])
  })

  it('defaults to the user home directory when env var is empty', async () => {
    process.env.MCP_GIT_AUDIT_SAFE_ROOTS = '   '
    const { SAFE_ROOTS } = await import('./config.js')
    expect(SAFE_ROOTS).toEqual([os.homedir()])
  })

  it('expands a bare ~ to the home directory', async () => {
    process.env.MCP_GIT_AUDIT_SAFE_ROOTS = '~'
    const { SAFE_ROOTS } = await import('./config.js')
    expect(SAFE_ROOTS).toEqual([os.homedir()])
  })

  it('accepts a single path', async () => {
    process.env.MCP_GIT_AUDIT_SAFE_ROOTS = '~/dev'
    const { SAFE_ROOTS } = await import('./config.js')
    expect(SAFE_ROOTS).toEqual([path.join(os.homedir(), 'dev')])
  })

  it('expands ~/ in each entry', async () => {
    process.env.MCP_GIT_AUDIT_SAFE_ROOTS = '~/foo:~/bar'
    const { SAFE_ROOTS } = await import('./config.js')
    expect(SAFE_ROOTS).toEqual([path.join(os.homedir(), 'foo'), path.join(os.homedir(), 'bar')])
  })

  it('accepts a colon-separated list of absolute paths', async () => {
    process.env.MCP_GIT_AUDIT_SAFE_ROOTS = '/tmp/a : /tmp/b'
    const { SAFE_ROOTS } = await import('./config.js')
    expect(SAFE_ROOTS).toEqual(['/tmp/a', '/tmp/b'])
  })

  it('deduplicates equivalent entries', async () => {
    process.env.MCP_GIT_AUDIT_SAFE_ROOTS = '/tmp/x:/tmp/x'
    const { SAFE_ROOTS } = await import('./config.js')
    expect(SAFE_ROOTS).toEqual(['/tmp/x'])
  })

  it('throws when every entry parses to empty', async () => {
    process.env.MCP_GIT_AUDIT_SAFE_ROOTS = ' : : '
    await expect(import('./config.js')).rejects.toThrow(/at least one path/)
  })
})

describe('parseNonNegativeInt (AUDIT_LOG_MAX_BYTES / AUDIT_LOG_KEEP)', () => {
  afterEach(() => {
    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES
    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP
  })

  it('parses a valid non-negative integer', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES = '2048'
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP = '3'
    const { AUDIT_LOG_MAX_BYTES, AUDIT_LOG_KEEP } = await import('./config.js')
    expect(AUDIT_LOG_MAX_BYTES).toBe(2048)
    expect(AUDIT_LOG_KEEP).toBe(3)
  })

  it('falls back to the default when unset', async () => {
    delete process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES
    const { AUDIT_LOG_MAX_BYTES } = await import('./config.js')
    expect(AUDIT_LOG_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it('throws on a non-numeric value', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES = 'lots'
    await expect(import('./config.js')).rejects.toThrow(/MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES="lots"/)
  })

  it('throws on a negative value', async () => {
    process.env.MCP_GIT_AUDIT_AUDIT_LOG_KEEP = '-1'
    await expect(import('./config.js')).rejects.toThrow(/MCP_GIT_AUDIT_AUDIT_LOG_KEEP="-1"/)
  })
})
