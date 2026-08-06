import { describe, expect, it } from 'vitest'
import { branchNameSchema, remoteNameSchema, remoteUrlSchema } from './git-exec.js'

describe('remoteNameSchema', () => {
  it('accepts typical remote names', () => {
    for (const ok of ['origin', 'upstream', 'fork-1', 'a_b.c', 'X', 'a'.repeat(100)]) {
      expect(remoteNameSchema.safeParse(ok).success).toBe(true)
    }
  })

  it('rejects names that could look like git options or escape', () => {
    for (const bad of ['', '-x', '--opt', '.hidden', 'has space', 'has/slash', 'has\\bslash', 'a'.repeat(101)]) {
      expect(remoteNameSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('branchNameSchema', () => {
  it('accepts typical branch names including slashes', () => {
    for (const ok of ['main', 'feature/foo', 'release-1.2.3', 'a_b/c.d']) {
      expect(branchNameSchema.safeParse(ok).success).toBe(true)
    }
  })

  it('rejects ref shapes git itself disallows + option-injection shapes', () => {
    for (const bad of ['', '-x', '.hidden', '/leading-slash', 'has..dots', 'trailing/']) {
      expect(branchNameSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('remoteUrlSchema', () => {
  it('accepts URLs of various transports', () => {
    for (const ok of [
      'https://example.com/foo.git',
      'git@github.com:owner/repo.git',
      'ssh://user@host/path',
      'file:///tmp/bare.git',
      '/abs/path/bare.git'
    ]) {
      expect(remoteUrlSchema.safeParse(ok).success).toBe(true)
    }
  })

  it('rejects URLs that look like options or contain control chars', () => {
    for (const bad of ['', '-upload-pack=evil', '--exec=evil', 'has\nnewline', 'has\rcr', 'has\0null']) {
      expect(remoteUrlSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('rejects URLs over the length cap', () => {
    expect(remoteUrlSchema.safeParse(`https://${'x'.repeat(2050)}`).success).toBe(false)
  })
})
