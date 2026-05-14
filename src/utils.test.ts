import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { errMessage, errorResult, expandHome, isNodeError, jsonResult, resolveAgainstSafeRoots } from './utils.js'

describe('expandHome', () => {
  it('expands a leading ~/ to the user home directory', () => {
    expect(expandHome('~/foo/bar')).toBe(path.join(os.homedir(), 'foo/bar'))
  })

  it('leaves an absolute path unchanged', () => {
    expect(expandHome('/tmp/x')).toBe('/tmp/x')
  })

  it('leaves a relative path unchanged', () => {
    expect(expandHome('foo/bar')).toBe('foo/bar')
  })
})

describe('errorResult', () => {
  it('builds the MCP error response shape', () => {
    expect(errorResult('boom')).toEqual({ isError: true, content: [{ type: 'text', text: 'boom' }] })
  })
})

describe('jsonResult', () => {
  it('serialises a payload to pretty JSON in a text block', () => {
    const r = jsonResult({ a: 1 })
    expect(r.content[0].type).toBe('text')
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 })
  })
})

describe('isNodeError', () => {
  it('returns true for ENOENT-shaped errors', () => {
    const e = Object.assign(new Error('x'), { code: 'ENOENT' })
    expect(isNodeError(e)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isNodeError(new Error('x'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isNodeError('s')).toBe(false)
    expect(isNodeError(null)).toBe(false)
  })
})

describe('errMessage', () => {
  it('returns the message for an Error', () => {
    expect(errMessage(new Error('boom'))).toBe('boom')
  })

  it('stringifies non-Error values', () => {
    expect(errMessage('boom')).toBe('boom')
    expect(errMessage(42)).toBe('42')
  })
})

describe('resolveAgainstSafeRoots', () => {
  const tmpRoot = path.join(os.tmpdir(), 'mcp-git-audit-utils', `run-${process.pid}`)
  const safeA = path.join(tmpRoot, 'safeA')
  const safeB = path.join(tmpRoot, 'safeB')

  beforeAll(async () => {
    await fs.mkdir(safeA, { recursive: true })
    await fs.mkdir(path.join(safeA, 'inner', 'deep'), { recursive: true })
    await fs.mkdir(safeB, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('accepts the safe root itself', async () => {
    await expect(resolveAgainstSafeRoots(safeA, [safeA, safeB])).resolves.toBe(await fs.realpath(safeA))
  })

  it('accepts a path inside a safe root', async () => {
    const inside = path.join(safeA, 'inner', 'deep')
    await expect(resolveAgainstSafeRoots(inside, [safeA, safeB])).resolves.toBe(await fs.realpath(inside))
  })

  it('accepts a path inside the second safe root', async () => {
    await expect(resolveAgainstSafeRoots(safeB, [safeA, safeB])).resolves.toBe(await fs.realpath(safeB))
  })

  it('rejects a path outside every safe root', async () => {
    const outside = path.join(tmpRoot, 'not-safe')
    await fs.mkdir(outside, { recursive: true })
    await expect(resolveAgainstSafeRoots(outside, [safeA, safeB])).rejects.toThrow(/not inside any configured safe_root/)
  })

  it('rejects a relative path', async () => {
    await expect(resolveAgainstSafeRoots('relative/path', [safeA])).rejects.toThrow(/must be an absolute path/)
  })

  it('expands ~/ before checking', async () => {
    // expand ~/<something-that-cannot-exist-under-home> — should still reject cleanly
    await expect(resolveAgainstSafeRoots('~/__mcp_git_audit_definitely_not_real__', [safeA])).rejects.toThrow(/not inside any configured safe_root/)
  })

  it('accepts a path that does not exist yet, as long as its nearest existing ancestor is inside a safe root', async () => {
    const future = path.join(safeA, 'inner', 'does-not-exist-yet')
    await expect(resolveAgainstSafeRoots(future, [safeA, safeB])).resolves.toMatch(/safeA/)
  })

  it('resolves symlinks before checking', async () => {
    const outside = path.join(tmpRoot, 'outside-target')
    await fs.mkdir(outside, { recursive: true })
    const linkInsideSafe = path.join(safeA, 'link-to-outside')
    try {
      await fs.symlink(outside, linkInsideSafe)
    } catch {
      // already exists from a prior run
    }
    await expect(resolveAgainstSafeRoots(linkInsideSafe, [safeA, safeB])).rejects.toThrow(/not inside any configured safe_root/)
  })
})
