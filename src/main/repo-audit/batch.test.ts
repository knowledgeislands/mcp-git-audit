import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Wrap (not replace) `execFile`, which every Git invocation goes through via
// `promisify`, so tests can prove which directories Git was pointed at and
// that no root is touched when the request is rejected.
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
const { auditRootsWithinSafeRoots } = await import('./batch.js')
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

const created = path.join(os.tmpdir(), 'mcp-git-audit-batch', `run-${process.pid}`)
let base = created
let safe = ''
let outside = ''
let SAFE_ROOTS: readonly string[] = []
const originalHome = process.env.HOME

const makeRepo = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf-8')
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-q', '-m', 'initial')
}

const gitCalls = (): string[][] => promisedExecFile.mock.calls.filter((c) => c[0] === 'git').map((c) => c[1])
const gitTargets = (): string[] => gitCalls().map((args) => args[args.indexOf('-C') + 1] as string)

beforeAll(async () => {
  await fs.rm(created, { recursive: true, force: true })
  await fs.mkdir(created, { recursive: true })
  // Canonicalise once (macOS tmpdir is itself a symlink) so expectations compare canonical paths.
  base = await fs.realpath(created)
  safe = path.join(base, 'safe')
  outside = path.join(base, 'outside')
  SAFE_ROOTS = [safe]

  for (const name of ['r1', 'r2', 'r3']) await makeRepo(path.join(safe, 'one', 'g', name))
  for (const name of ['s1', 's2']) await makeRepo(path.join(safe, 'two', 'g', name))
  await fs.mkdir(path.join(safe, 'empty'), { recursive: true })
  await fs.writeFile(path.join(safe, 'file.txt'), 'not a directory\n', 'utf-8')
  await makeRepo(path.join(safe, 'bad', 'g', 'ok'))
  await makeRepo(path.join(outside, 'foreign'))
  await git(
    path.join(outside, 'foreign'),
    'worktree',
    'add',
    '-q',
    path.join(safe, 'bad', 'g', 'wt-escape'),
    '-b',
    'wt'
  )
  await fs.symlink(path.join(safe, 'one'), path.join(safe, 'alias'))
  await fs.symlink(outside, path.join(safe, 'escape-link'))

  // `~/` resolves through $HOME; point it at the fixture so no real user root is read.
  process.env.HOME = safe
})

afterAll(async () => {
  process.env.HOME = originalHome
  await fs.rm(created, { recursive: true, force: true })
})

beforeEach(() => {
  promisedExecFile.mockClear()
})

const opts = { max_depth: 2, limit: 100 }

describe('auditRootsWithinSafeRoots', () => {
  it('audits each root in request order and reports ok roots with their requested and canonical identity', async () => {
    const result = await auditRootsWithinSafeRoots(SAFE_ROOTS, [path.join(safe, 'two'), path.join(safe, 'one')], opts)

    expect(result).toMatchObject({ limit: 100, max_depth: 2, duplicate_roots: [] })
    expect(Number.isNaN(Date.parse(result.requested_at))).toBe(false)
    expect(result.roots.map((r) => [r.requested, r.root, r.status, r.omitted])).toEqual([
      [path.join(safe, 'two'), path.join(safe, 'two'), 'ok', 0],
      [path.join(safe, 'one'), path.join(safe, 'one'), 'ok', 0]
    ])
    expect(result.roots.map((r) => r.repos.map((repo) => repo.path))).toEqual([
      ['g/s1', 'g/s2'],
      ['g/r1', 'g/r2', 'g/r3']
    ])
    for (const root of result.roots) {
      expect(root.errors).toEqual([])
      expect(root.scanned_at).not.toBeNull()
      expect(root.audited_at).not.toBeNull()
    }
    expect(gitCalls().some((args) => args.includes('fetch'))).toBe(false)
  })

  it('reports an empty root as ok with no repositories and nothing audited', async () => {
    const result = await auditRootsWithinSafeRoots(SAFE_ROOTS, [path.join(safe, 'empty')], opts)
    expect(result.roots).toEqual([
      expect.objectContaining({ status: 'ok', repos: [], errors: [], omitted: 0, audited_at: null })
    ])
    expect(result.roots[0]?.scanned_at).not.toBeNull()
    expect(gitCalls()).toEqual([])
  })

  it('removes exact canonical duplicates reached through ~/ and symlink aliases, keeping the first request', async () => {
    const one = path.join(safe, 'one')
    const result = await auditRootsWithinSafeRoots(
      SAFE_ROOTS,
      [one, path.join(safe, 'two'), '~/one', path.join(safe, 'alias')],
      opts
    )

    expect(result.roots.map((r) => r.root)).toEqual([one, path.join(safe, 'two')])
    expect(result.duplicate_roots).toEqual([
      { requested: '~/one', canonical: one, duplicate_of_index: 0 },
      { requested: path.join(safe, 'alias'), canonical: one, duplicate_of_index: 0 }
    ])
  })

  it('reports the first request as the result identity when it is itself an alias', async () => {
    const result = await auditRootsWithinSafeRoots(SAFE_ROOTS, [path.join(safe, 'alias'), path.join(safe, 'one')], opts)
    expect(result.roots).toEqual([
      expect.objectContaining({ requested: path.join(safe, 'alias'), root: path.join(safe, 'one'), status: 'ok' })
    ])
    expect(result.duplicate_roots).toEqual([
      { requested: path.join(safe, 'one'), canonical: path.join(safe, 'one'), duplicate_of_index: 0 }
    ])
  })

  it('keeps overlapping distinct roots separate, repeating repositories against the shared limit', async () => {
    const result = await auditRootsWithinSafeRoots(SAFE_ROOTS, [path.join(safe, 'one'), path.join(safe, 'one', 'g')], {
      max_depth: 2,
      limit: 5
    })
    expect(result.duplicate_roots).toEqual([])
    expect(result.roots.map((r) => [r.status, r.repos.map((repo) => repo.path), r.omitted])).toEqual([
      ['ok', ['g/r1', 'g/r2', 'g/r3'], 0],
      ['partial', ['r1', 'r2'], 1]
    ])
  })

  it('spends the whole-request limit across a root boundary and runs Git only for selected repositories', async () => {
    const one = path.join(safe, 'one')
    const two = path.join(safe, 'two')

    const crossing = await auditRootsWithinSafeRoots(SAFE_ROOTS, [one, two], { max_depth: 2, limit: 4 })
    expect(crossing.roots.map((r) => [r.status, r.repos.map((repo) => repo.path), r.omitted])).toEqual([
      ['ok', ['g/r1', 'g/r2', 'g/r3'], 0],
      ['partial', ['g/s1'], 1]
    ])
    expect(gitTargets()).not.toContain(path.join(two, 'g', 's2'))

    promisedExecFile.mockClear()
    const exhausted = await auditRootsWithinSafeRoots(SAFE_ROOTS, [one, two], { max_depth: 2, limit: 2 })
    expect(exhausted.roots.map((r) => [r.status, r.repos.length, r.omitted])).toEqual([
      ['partial', 2, 1],
      ['partial', 0, 2]
    ])
    expect(exhausted.roots[1]?.scanned_at).not.toBeNull()
    expect(exhausted.roots[1]?.audited_at).toBeNull()
    const targets = gitTargets()
    expect(
      targets.every((t) => t.startsWith(path.join(one, 'g', 'r1')) || t.startsWith(path.join(one, 'g', 'r2')))
    ).toBe(true)
  })

  it('reports absent and non-directory roots as per-root errors without failing their peers', async () => {
    const missing = path.join(safe, 'missing')
    const file = path.join(safe, 'file.txt')
    const result = await auditRootsWithinSafeRoots(SAFE_ROOTS, [missing, path.join(safe, 'two'), file], opts)

    expect(result.roots.map((r) => r.status)).toEqual(['error', 'ok', 'error'])
    expect(result.roots[0]).toEqual({
      requested: missing,
      root: missing,
      status: 'error',
      scanned_at: null,
      audited_at: null,
      repos: [],
      errors: [{ path: missing, message: expect.stringMatching(/^root is not accessible: .*ENOENT/) }],
      omitted: 0
    })
    expect(result.roots[2]?.errors).toEqual([{ path: file, message: 'root is not a directory' }])
    expect(result.roots[1]?.repos).toHaveLength(2)
  })

  it('never walks a lexically normalised form of a missing root that would step outside its authorised ancestor', async () => {
    const trick = `${safe}/missing/../../outside`
    const result = await auditRootsWithinSafeRoots(SAFE_ROOTS, [trick], opts)
    expect(result.roots).toEqual([
      expect.objectContaining({ requested: trick, root: trick, status: 'error', repos: [], scanned_at: null })
    ])
    expect(gitCalls()).toEqual([])
  })

  it('marks a root partial when a repository fails authority checks, auditing the rest', async () => {
    const result = await auditRootsWithinSafeRoots(SAFE_ROOTS, [path.join(safe, 'bad')], opts)
    expect(result.roots[0]?.status).toBe('partial')
    expect(result.roots[0]?.repos.map((r) => r.path)).toEqual(['g/ok'])
    expect(result.roots[0]?.errors).toEqual([
      { path: 'g/wt-escape', message: expect.stringMatching(/gitdir target escapes the configured safe roots/) }
    ])
    expect(gitTargets().some((t) => t.includes('wt-escape'))).toBe(false)
  })

  it.each([
    ['a relative root', 'two', /^roots\[1\]: root must be an absolute path or start with ~\//],
    ['an escaping root', '/', /^roots\[1\]: .*not inside any configured safe_root/],
    ['a symlink escape', 'escape-link', /^roots\[1\]: .*not inside any configured safe_root/]
  ])('rejects the whole request for %s before touching any root', async (_label, second, message) => {
    const requested = second === 'escape-link' ? path.join(safe, 'escape-link') : second
    await expect(auditRootsWithinSafeRoots(SAFE_ROOTS, [path.join(safe, 'one'), requested], opts)).rejects.toThrow(
      message
    )
    expect(gitCalls()).toEqual([])
  })
})
