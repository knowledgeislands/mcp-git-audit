import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findRepos, scanRoot } from './scan.js'

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

const tmpRoot = path.join(os.tmpdir(), 'mcp-git-audit-scan', `run-${process.pid}`)

const makeRepo = async (relPath: string): Promise<string> => {
  const dir = path.join(tmpRoot, relPath)
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf-8')
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-q', '-m', 'initial')
  return dir
}

beforeAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
  await fs.mkdir(tmpRoot, { recursive: true })
  await makeRepo('alpha/one')
  await makeRepo('alpha/two')
  await makeRepo('beta/three')
  await makeRepo('depth-1-repo')
  // Hidden dir at the walk root with a repo inside — should be skipped.
  const hidden = path.join(tmpRoot, '.hidden')
  await fs.mkdir(hidden, { recursive: true })
  await git(hidden, 'init', '-q', '-b', 'main')
  // node_modules at the walk root with a repo inside — should be skipped.
  const nm = path.join(tmpRoot, 'node_modules', 'something')
  await fs.mkdir(nm, { recursive: true })
  await git(nm, 'init', '-q', '-b', 'main')
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('findRepos', () => {
  it('finds all repos within max_depth=2', async () => {
    const repos = await findRepos(tmpRoot, 2)
    const rel = repos.map((r) => path.relative(tmpRoot, r).split(path.sep).join('/')).sort()
    expect(rel).toEqual(['alpha/one', 'alpha/two', 'beta/three', 'depth-1-repo'])
  })

  it('honours max_depth=1 — only top-level repos', async () => {
    const repos = await findRepos(tmpRoot, 1)
    const rel = repos.map((r) => path.relative(tmpRoot, r).split(path.sep).join('/'))
    expect(rel).toEqual(['depth-1-repo'])
  })

  it('returns empty for a missing root', async () => {
    expect(await findRepos(path.join(tmpRoot, 'no-such'), 2)).toEqual([])
  })

  it('skips hidden directories', async () => {
    // .hidden is at depth 1 and contains its own .git — confirm it's NOT in the result.
    const repos = await findRepos(tmpRoot, 2)
    expect(repos.some((r) => r.includes('.hidden'))).toBe(false)
  })

  it('skips node_modules directories', async () => {
    // node_modules/something is at depth 2 and contains its own .git — confirm it's NOT in the result.
    const repos = await findRepos(tmpRoot, 2)
    expect(repos.some((r) => r.includes('node_modules'))).toBe(false)
  })

  it('does not push the root itself as a repo when root is a .git directory', async () => {
    // Make a freshly-initialised repo at a separate path and call findRepos starting AT it.
    // Per `groupAndName` contract, repos directly at depth 0 (root itself) are skipped — the
    // root-is-a-repo case has no relative path to anchor.
    const onlyRepo = path.join(os.tmpdir(), 'mcp-git-audit-scan-root', `run-${process.pid}`)
    await fs.rm(onlyRepo, { recursive: true, force: true })
    await fs.mkdir(onlyRepo, { recursive: true })
    await git(onlyRepo, 'init', '-q', '-b', 'main')
    try {
      const repos = await findRepos(onlyRepo, 2)
      expect(repos).toEqual([])
    } finally {
      await fs.rm(onlyRepo, { recursive: true, force: true })
    }
  })
})

describe('scanRoot', () => {
  it('returns the scan envelope with sorted repos and absolute paths', async () => {
    const result = await scanRoot(tmpRoot, { max_depth: 2 })
    expect(Object.keys(result).sort()).toEqual(['repos', 'root', 'scanned_at'])
    expect(result.root).toBe(tmpRoot)
    expect(result.scanned_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const summary = result.repos.map((r) => `${r.group}/${r.name}`)
    expect(summary).toEqual(['(root)/depth-1-repo', 'alpha/one', 'alpha/two', 'beta/three'])
    // Each repo carries an absolute path; the relative `path` is forward-slashed.
    for (const r of result.repos) {
      expect(path.isAbsolute(r.abs_path)).toBe(true)
      expect(r.abs_path).toBe(path.join(tmpRoot, r.path))
    }
  })

  it('assigns group="(root)" for repos at depth 1', async () => {
    const result = await scanRoot(tmpRoot, { max_depth: 2 })
    const root = result.repos.find((r) => r.name === 'depth-1-repo')
    expect(root?.group).toBe('(root)')
    expect(root?.path).toBe('depth-1-repo')
  })
})
