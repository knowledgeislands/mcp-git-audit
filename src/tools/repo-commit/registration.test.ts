import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import type { McpServer } from '@modelcontextprotocol/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { Config } from '../../config/index.js'
import { registerRepoCommitTools } from './index.js'

// Exercises git_repo_commit at the MCP boundary: input validation through the
// declared schema (as the server does) and structured responses against the
// declared output schema, so wire-contract drift fails here.

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

const base = path.join(os.tmpdir(), 'mcp-git-audit-commit-registration', `run-${process.pid}`)
const safe = path.join(base, 'safe')

interface Registered {
  config: { outputSchema: z.ZodType; inputSchema: z.ZodType }
  handler: (args: unknown) => Promise<{ isError?: boolean; structuredContent?: unknown; content: { text: string }[] }>
}

const tools = new Map<string, Registered>()
const commitTool = (): Registered => {
  const tool = tools.get('git_repo_commit')
  if (!tool) throw new Error('git_repo_commit not registered')
  return tool
}

const makeRepo = async (name: string): Promise<string> => {
  const dir = path.join(safe, name)
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await git(dir, 'config', 'user.name', 'test')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf-8')
  await git(dir, 'add', 'README.md')
  await git(dir, 'commit', '-q', '-m', 'initial')
  return dir
}

/** Validate input through the declared schema, run the handler, and validate the structured output. */
const callCommit = async (args: unknown) => {
  const tool = commitTool()
  const result = await tool.handler(tool.config.inputSchema.parse(args))
  const output = result.isError ? undefined : tool.config.outputSchema.parse(result.structuredContent)
  return { result, output: output as Record<string, unknown> | undefined }
}

beforeAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
  await fs.mkdir(safe, { recursive: true })
  const stub = {
    registerTool: (name: string, config: Registered['config'], handler: Registered['handler']) => {
      tools.set(name, { config, handler })
    }
  }
  const cfg: Config = {
    safeRoots: [safe],
    accessLevel: 'destructive',
    auditLogMode: 'off',
    auditLogPath: '/dev/null',
    auditLogMaxBytes: 0,
    auditLogKeep: 0
  }
  registerRepoCommitTools(stub as unknown as McpServer, cfg)
})

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('git_repo_commit input schema', () => {
  it('rejects the removed broad stage values', () => {
    const schema = commitTool().config.inputSchema
    for (const stage of ['all_tracked', 'all', 'none']) {
      expect(schema.safeParse({ abs_path: '/x', message: 'm', stage, paths: ['a.txt'] }).success).toBe(false)
    }
  })

  it('requires a non-empty paths list and defaults to stage="paths" with a dry run', () => {
    const schema = commitTool().config.inputSchema
    expect(schema.safeParse({ abs_path: '/x', message: 'm' }).success).toBe(false)
    expect(schema.safeParse({ abs_path: '/x', message: 'm', paths: [] }).success).toBe(false)
    expect(schema.parse({ abs_path: '/x', message: 'm', paths: ['a.txt'] })).toMatchObject({
      stage: 'paths',
      dry_run: true,
      allow_empty: false
    })
    expect(schema.safeParse({ abs_path: '/x', message: 'm', paths: ['a.txt'], amend: true }).success).toBe(false)
  })
})

describe('git_repo_commit structured response', () => {
  it('previews without touching the real index and matches the output schema', async () => {
    const repo = await makeRepo('preview')
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n', 'utf-8')
    await fs.writeFile(path.join(repo, 'b.txt'), 'b\n', 'utf-8')
    await git(repo, 'add', 'b.txt')
    const indexBefore = await fs.readFile(path.join(repo, '.git', 'index'))
    const { output } = await callCommit({ abs_path: repo, message: 'preview', paths: ['a.txt'] })
    expect(output).toMatchObject({ ok: true, dry_run: true, sha: null, stage: 'paths', staged_paths: ['a.txt'] })
    expect((await fs.readFile(path.join(repo, '.git', 'index'))).equals(indexBefore)).toBe(true)
  })

  it('returns rejected paths and hook modifications as ok:false structured results', async () => {
    const repo = await makeRepo('refusals')
    const rejected = await callCommit({ abs_path: repo, message: 'm', paths: ['*.md'], dry_run: false })
    expect(rejected.output).toMatchObject({ ok: false, rejected_paths: [{ path: '*.md' }] })

    const hook = path.join(repo, '.git', 'hooks', 'pre-commit')
    await fs.writeFile(hook, '#!/bin/sh\necho x > extra.txt\ngit add extra.txt\n', 'utf-8')
    await fs.chmod(hook, 0o755)
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n', 'utf-8')
    const hooked = await callCommit({ abs_path: repo, message: 'm', paths: ['a.txt'], dry_run: false })
    expect(hooked.output).toMatchObject({ ok: false, hook_modified_paths: ['extra.txt'] })
    expect(hooked.output?.sha).toEqual(expect.stringMatching(/^[0-9a-f]{7,}$/))
  })

  it('returns an error envelope for a repository outside the safe roots', async () => {
    const { result } = await callCommit({ abs_path: os.tmpdir(), message: 'm', paths: ['a.txt'] })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/^Error committing:/)
  })
})
