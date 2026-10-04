import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import type { McpServer } from '@modelcontextprotocol/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { Config } from '../../config/index.js'
import { registerRepoAuditTools } from './index.js'

// Exercises the registered tool handlers end to end and validates their
// structured responses against the declared output schemas, so a drift
// between implementation and wire contract fails here rather than at the client.

const execFileP = promisify(execFile)
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (
    await execFileP('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com'
      }
    })
  ).stdout

const base = path.join(os.tmpdir(), 'mcp-git-audit-registration', `run-${process.pid}`)
const safe = path.join(base, 'safe')
const outside = path.join(base, 'outside')

interface Registered {
  config: { outputSchema: z.ZodType; inputSchema: z.ZodType }
  handler: (args: unknown) => Promise<{ isError?: boolean; structuredContent?: unknown; content: { text: string }[] }>
}

const tools = new Map<string, Registered>()

const makeRepo = async (dir: string): Promise<string> => {
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf-8')
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-q', '-m', 'initial')
  return (await git(dir, 'rev-parse', 'HEAD')).trim()
}

/** Validate input through the declared schema (as the server does), run the handler, and return its result. */
const call = async (name: string, args: unknown) => {
  const tool = tools.get(name)
  if (!tool) throw new Error(`tool not registered: ${name}`)
  return tool.handler(tool.config.inputSchema.parse(args))
}

beforeAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
  await fs.mkdir(safe, { recursive: true })
  const head = await makeRepo(path.join(safe, 'repo'))
  const repo = path.join(safe, 'repo')
  await git(repo, 'update-index', '--add', '--cacheinfo', `160000,${head},vendor/lib`)
  await git(repo, 'commit', '-q', '-m', 'gitlink')
  await fs.writeFile(path.join(repo, 'README.md'), '# stashed\n', 'utf-8')
  await git(repo, 'stash', 'push', '-q')
  const foreign = path.join(outside, 'foreign')
  await makeRepo(foreign)
  await git(foreign, 'worktree', 'add', '-q', path.join(safe, 'wt-escape'), '-b', 'wt-escape')

  const stub = {
    registerTool: (name: string, config: Registered['config'], handler: Registered['handler']) => {
      tools.set(name, { config, handler })
    }
  }
  const cfg: Config = {
    safeRoots: [safe],
    accessLevel: 'read',
    auditLogMode: 'off',
    auditLogPath: '/dev/null',
    auditLogMaxBytes: 0,
    auditLogKeep: 0
  }
  registerRepoAuditTools(stub as unknown as McpServer, cfg)
})

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('git_repos_audit structured response', () => {
  it('matches the declared output schema, including stash, submodules and path/message errors', async () => {
    const scan = await call('git_repos_scan', { root: safe })
    expect(scan.isError).toBeUndefined()
    const result = await call('git_repos_audit', { scan: scan.structuredContent })
    expect(result.isError).toBeUndefined()
    const parsed = tools.get('git_repos_audit')?.config.outputSchema.parse(result.structuredContent) as {
      repos: { stash: unknown; submodules: { entries: unknown[] } }[]
      errors: { path: string; message: string }[]
    }
    expect(parsed.repos[0]?.stash).toEqual({ status: 'available', count: 1 })
    expect(parsed.repos[0]?.submodules.entries).toEqual([
      expect.objectContaining({ path: 'vendor/lib', state: 'uninitialised' })
    ])
    expect(parsed.errors).toEqual([{ path: 'wt-escape', message: expect.stringMatching(/unsupported Git metadata/) }])
  })

  it('returns an error envelope when a cached scan escapes the safe roots', async () => {
    const result = await call('git_repos_audit', {
      scan: {
        root: safe,
        scanned_at: new Date().toISOString(),
        repos: [{ path: 'x', abs_path: outside, group: '(root)', name: 'x' }]
      }
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not inside any configured safe_root/)
  })
})
