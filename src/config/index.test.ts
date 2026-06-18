import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from './index.js'

// loadConfig reads from the env object it's given, so tests pass explicit envs
// (no process.env mutation, no module-reset dance).
const load = (extra: Record<string, string> = {}) => loadConfig({ ...extra })

describe('loadConfig', () => {
  describe('safeRoots', () => {
    it('defaults to the user home directory when env var is unset', () => {
      expect(load().safeRoots).toEqual([os.homedir()])
    })

    it('defaults to the user home directory when env var is empty', () => {
      expect(load({ MCP_GIT_AUDIT_SAFE_ROOTS: '   ' }).safeRoots).toEqual([os.homedir()])
    })

    it('expands a bare ~ to the home directory', () => {
      expect(load({ MCP_GIT_AUDIT_SAFE_ROOTS: '~' }).safeRoots).toEqual([os.homedir()])
    })

    it('accepts a single path', () => {
      expect(load({ MCP_GIT_AUDIT_SAFE_ROOTS: '~/dev' }).safeRoots).toEqual([path.join(os.homedir(), 'dev')])
    })

    it('expands ~/ in each entry', () => {
      expect(load({ MCP_GIT_AUDIT_SAFE_ROOTS: '~/foo:~/bar' }).safeRoots).toEqual([path.join(os.homedir(), 'foo'), path.join(os.homedir(), 'bar')])
    })

    it('accepts a colon-separated list of absolute paths', () => {
      expect(load({ MCP_GIT_AUDIT_SAFE_ROOTS: '/tmp/a : /tmp/b' }).safeRoots).toEqual(['/tmp/a', '/tmp/b'])
    })

    it('deduplicates equivalent entries', () => {
      expect(load({ MCP_GIT_AUDIT_SAFE_ROOTS: '/tmp/x:/tmp/x' }).safeRoots).toEqual(['/tmp/x'])
    })

    it('throws when every entry parses to empty', () => {
      expect(() => load({ MCP_GIT_AUDIT_SAFE_ROOTS: ' : : ' })).toThrow(/at least one path/)
    })

    it('freezes the resolved list', () => {
      expect(Object.isFrozen(load().safeRoots)).toBe(true)
    })
  })

  describe('accessLevel', () => {
    it('defaults to read when unset', () => {
      expect(load().accessLevel).toBe('read')
    })

    it('defaults to read when blank', () => {
      expect(load({ MCP_GIT_AUDIT_ACCESS_LEVEL: '  ' }).accessLevel).toBe('read')
    })

    it.each(['read', 'write', 'destructive'] as const)('accepts %s', (level) => {
      expect(load({ MCP_GIT_AUDIT_ACCESS_LEVEL: level }).accessLevel).toBe(level)
    })

    it('throws on an unknown value', () => {
      expect(() => load({ MCP_GIT_AUDIT_ACCESS_LEVEL: 'admin' })).toThrow(/Invalid MCP_GIT_AUDIT_ACCESS_LEVEL="admin"/)
    })
  })

  describe('auditLogMode', () => {
    it('defaults to writes', () => {
      expect(load().auditLogMode).toBe('writes')
    })

    it('defaults to writes when blank', () => {
      expect(load({ MCP_GIT_AUDIT_AUDIT_LOG: '  ' }).auditLogMode).toBe('writes')
    })

    it.each(['off', 'writes', 'all'] as const)('accepts %s', (mode) => {
      expect(load({ MCP_GIT_AUDIT_AUDIT_LOG: mode }).auditLogMode).toBe(mode)
    })

    it('throws on an unknown value', () => {
      expect(() => load({ MCP_GIT_AUDIT_AUDIT_LOG: 'sometimes' })).toThrow(/Invalid MCP_GIT_AUDIT_AUDIT_LOG/)
    })
  })

  describe('auditLogPath', () => {
    it('defaults to ~/.local/state/mcp-git-audit/audit.jsonl', () => {
      expect(load().auditLogPath).toBe(path.join(os.homedir(), '.local', 'state', 'mcp-git-audit', 'audit.jsonl'))
    })

    it('expands a bare ~ in the override', () => {
      expect(load({ MCP_GIT_AUDIT_AUDIT_LOG_PATH: '~' }).auditLogPath).toBe(os.homedir())
    })

    it('expands ~/foo in the override', () => {
      expect(load({ MCP_GIT_AUDIT_AUDIT_LOG_PATH: '~/foo/audit.jsonl' }).auditLogPath).toBe(path.join(os.homedir(), 'foo', 'audit.jsonl'))
    })

    it('passes absolute paths through unchanged', () => {
      expect(load({ MCP_GIT_AUDIT_AUDIT_LOG_PATH: '/tmp/audit.jsonl' }).auditLogPath).toBe('/tmp/audit.jsonl')
    })
  })

  describe('hydrateEnvFromFiles (via loadConfig)', () => {
    // Every loadConfig call hydrates process.env from the package's `.env*`
    // files; that step branches on whether NODE_ENV is set. Exercise both arms.
    // Values still come from the explicit env literal, so the observable
    // contract is that hydration is NODE_ENV-agnostic and never throws.
    it('loads regardless of whether NODE_ENV is set', async () => {
      const { loadConfig } = await import('./index.js')
      const original = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = 'production'
        expect(loadConfig({ MCP_GIT_AUDIT_ACCESS_LEVEL: 'write' }).accessLevel).toBe('write')
        delete process.env.NODE_ENV
        expect(loadConfig({ MCP_GIT_AUDIT_ACCESS_LEVEL: 'write' }).accessLevel).toBe('write')
      } finally {
        if (original === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = original
      }
    })
  })

  describe('auditLogMaxBytes / auditLogKeep', () => {
    it('use sensible defaults when unset', () => {
      const cfg = load()
      expect(cfg.auditLogMaxBytes).toBe(10 * 1024 * 1024)
      expect(cfg.auditLogKeep).toBe(5)
    })

    it('use defaults when blank', () => {
      const cfg = load({ MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES: '  ', MCP_GIT_AUDIT_AUDIT_LOG_KEEP: '  ' })
      expect(cfg.auditLogMaxBytes).toBe(10 * 1024 * 1024)
      expect(cfg.auditLogKeep).toBe(5)
    })

    it('accept non-negative ints', () => {
      const cfg = load({ MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES: '2048', MCP_GIT_AUDIT_AUDIT_LOG_KEEP: '3' })
      expect(cfg.auditLogMaxBytes).toBe(2048)
      expect(cfg.auditLogKeep).toBe(3)
    })

    it('throws on a negative value', () => {
      expect(() => load({ MCP_GIT_AUDIT_AUDIT_LOG_KEEP: '-1' })).toThrow(/MCP_GIT_AUDIT_AUDIT_LOG_KEEP="-1"/)
    })

    it('throws on a non-numeric value', () => {
      expect(() => load({ MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES: 'lots' })).toThrow(/MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES="lots"/)
    })
  })
})
