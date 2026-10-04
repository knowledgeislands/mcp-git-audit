import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Wrap (not replace) `execFile`, which every Git invocation goes through via
// `promisify`, so tests can prove which directories Git was pointed at.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const promised = vi.fn(promisify(actual.execFile))
  const execFile = Object.assign((...args: Parameters<typeof actual.execFile>) => actual.execFile(...args), {
    [promisify.custom]: promised
  })
  return { ...actual, execFile }
})

const childProcess = await import('node:child_process')
const { auditScanWithinRoots } = await import('./audit.js')
const { repoDetail } = await import('./detail.js')
const { scanRoot } = await import('./scan.js')
const promisedExecFile = vi.mocked(
  (childProcess.execFile as unknown as Record<symbol, (...args: unknown[]) => unknown>)[promisify.custom] as (
    file: string,
    args: string[]
  ) => unknown
)

const execFileP = promisify(execFile)
const git = (cwd: string, ...args: string[]) =>
  execFileP('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    }
  })

const base = path.join(os.tmpdir(), 'mcp-git-audit-authority', `run-${process.pid}`)
const safe = path.join(base, 'safe')
const outside = path.join(base, 'outside')
const SAFE_ROOTS: readonly string[] = [safe]

const makeRepo = async (dir: string): Promise<string> => {
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf-8')
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-q', '-m', 'initial')
  return dir
}

/** Every directory a Git process was pointed at (`git ... -C <dir> ...`). */
const gitTargets = (): string[] =>
  promisedExecFile.mock.calls.filter((c) => c[0] === 'git').map((c) => c[1][c[1].indexOf('-C') + 1] as string)

beforeAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
  await fs.mkdir(safe, { recursive: true })
  const main = await makeRepo(path.join(safe, 'group', 'main'))
  await git(main, 'worktree', 'add', '-q', path.join(safe, 'group', 'wt-ok'), '-b', 'wt-ok')
  const foreign = await makeRepo(path.join(outside, 'foreign'))
  await git(foreign, 'worktree', 'add', '-q', path.join(safe, 'group', 'wt-escape'), '-b', 'wt-escape')

  // A parent whose first-level submodule points at metadata outside the safe roots.
  const parent = await makeRepo(path.join(safe, 'subs', 'parent'))
  const foreignHead = (await git(foreign, 'rev-parse', 'HEAD')).stdout.trim()
  await fs.mkdir(path.join(parent, 'child'), { recursive: true })
  await git(parent, 'update-index', '--add', '--cacheinfo', `160000,${foreignHead},child`)
  await git(parent, 'commit', '-q', '-m', 'gitlink')
  await fs.writeFile(path.join(parent, 'child', '.git'), `gitdir: ${path.join(foreign, '.git')}\n`, 'utf-8')
})

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

beforeEach(() => {
  promisedExecFile.mockClear()
})

describe('auditScanWithinRoots', () => {
  it('audits ordinary repositories and authorised worktrees, and reports escaping worktrees without running Git', async () => {
    const scan = await scanRoot(safe, { max_depth: 2 })
    expect(scan.repos.map((r) => r.path)).toEqual(['group/main', 'group/wt-escape', 'group/wt-ok', 'subs/parent'])

    const result = await auditScanWithinRoots(SAFE_ROOTS, scan, { include_stale_days: 30 })
    expect(result.repos.map((r) => [r.path, r.branch])).toEqual([
      ['group/main', 'main'],
      ['group/wt-ok', 'wt-ok'],
      ['subs/parent', 'main']
    ])
    expect(result.errors).toEqual([
      { path: 'group/wt-escape', message: expect.stringMatching(/gitdir target escapes the configured safe roots/) }
    ])

    const escapeReal = await fs.realpath(path.join(safe, 'group', 'wt-escape'))
    const targets = gitTargets()
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.some((t) => t === escapeReal || t === path.join(safe, 'group', 'wt-escape'))).toBe(false)
  })

  it('rejects the whole call when a cached scan path escapes the safe roots', async () => {
    const scan = {
      root: safe,
      scanned_at: new Date().toISOString(),
      repos: [{ path: 'foreign', abs_path: path.join(outside, 'foreign'), group: '(root)', name: 'foreign' }]
    }
    await expect(auditScanWithinRoots(SAFE_ROOTS, scan, { include_stale_days: 30 })).rejects.toThrow(
      /scan\.repos\[foreign\]\.abs_path: .*not inside any configured safe_root/
    )
    expect(gitTargets()).toEqual([])
  })

  it('rejects a cached scan whose root escapes the safe roots', async () => {
    const scan = { root: outside, scanned_at: new Date().toISOString(), repos: [] }
    await expect(auditScanWithinRoots(SAFE_ROOTS, scan, { include_stale_days: 30 })).rejects.toThrow(
      /not inside any configured safe_root/
    )
  })
})

describe('submodule authority', () => {
  it('never runs Git inside a submodule whose metadata escapes the safe roots', async () => {
    const scan = await scanRoot(path.join(safe, 'subs'), { max_depth: 1 })
    const result = await auditScanWithinRoots(SAFE_ROOTS, scan, { include_stale_days: 30 })
    expect(result.errors).toBeUndefined()
    expect(result.repos[0]?.submodules.entries).toEqual([
      expect.objectContaining({ path: 'child', state: 'unavailable', actual_commit: null, dirty: null })
    ])
    const child = path.join(safe, 'subs', 'parent', 'child')
    const childReal = path.join(await fs.realpath(path.join(safe, 'subs', 'parent')), 'child')
    const targets = gitTargets()
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.some((t) => t === child || t === childReal)).toBe(false)
    // No network, initialisation or recursive submodule command was issued.
    const argvs = promisedExecFile.mock.calls.map((c) => c[1].join(' '))
    expect(argvs.some((a) => /\b(fetch|clone|submodule|pull|push)\b|--recurse/.test(a))).toBe(false)
  })
})

describe('repoDetail metadata authority', () => {
  it('reads an authorised worktree', async () => {
    const result = await repoDetail(SAFE_ROOTS, path.join(safe, 'group', 'wt-ok'), {
      commits: 1,
      include_diffstat: false
    })
    expect(result.path).toBe('group/wt-ok')
    expect(result.commits.length).toBe(1)
  })

  it('rejects an escaping worktree before any Git process runs', async () => {
    await expect(
      repoDetail(SAFE_ROOTS, path.join(safe, 'group', 'wt-escape'), { commits: 1, include_diffstat: false })
    ).rejects.toThrow(/unsupported Git metadata: gitdir target escapes/)
    expect(gitTargets()).toEqual([])
  })
})
