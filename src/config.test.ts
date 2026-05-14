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
