import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditRepo, auditScan } from './audit.js'
import { scanRoot } from './scan.js'

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

const tmpRoot = path.join(os.tmpdir(), 'mcp-git-audit-audit', `run-${process.pid}`)

const makeRepo = async (relPath: string): Promise<string> => {
  const dir = path.join(tmpRoot, relPath)
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf-8')
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-q', '-m', 'initial')
  return dir
}

const repoFor = (relPath: string, group?: string, name?: string) => {
  const parts = relPath.split('/')
  return {
    path: relPath,
    abs_path: path.join(tmpRoot, relPath),
    group: group ?? parts[0],
    name: name ?? parts[parts.length - 1]
  }
}

beforeAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
  await fs.mkdir(tmpRoot, { recursive: true })

  // alpha/clean — committed, no remote
  await makeRepo('alpha/clean')

  // alpha/dirty — uncommitted modifications + untracked files
  const dirty = await makeRepo('alpha/dirty')
  await fs.writeFile(path.join(dirty, 'README.md'), '# changed\n', 'utf-8')
  await fs.writeFile(path.join(dirty, 'untracked.txt'), 'new\n', 'utf-8')

  // alpha/detached — HEAD detached at a specific sha
  const detached = await makeRepo('alpha/detached')
  await fs.writeFile(path.join(detached, 'b.md'), 'b\n', 'utf-8')
  await git(detached, 'add', '.')
  await git(detached, 'commit', '-q', '-m', 'second')
  const { stdout: shaOut } = await git(detached, 'rev-parse', 'HEAD~1')
  await git(detached, 'checkout', '-q', shaOut.trim())

  // beta/with-remote — has an upstream pointing at a local bare repo
  const upstreamBare = path.join(tmpRoot, '_upstream-bare.git')
  await fs.mkdir(upstreamBare, { recursive: true })
  await git(upstreamBare, 'init', '-q', '--bare', '-b', 'main')
  const withRemote = await makeRepo('beta/with-remote')
  await git(withRemote, 'remote', 'add', 'origin', upstreamBare)
  await git(withRemote, 'push', '-q', '-u', 'origin', 'main')

  // beta/corrupt — overwrite .git/HEAD with garbage so `git rev-parse HEAD` fails
  const corrupt = await makeRepo('beta/corrupt')
  await fs.writeFile(path.join(corrupt, '.git', 'HEAD'), 'not a valid ref\n', 'utf-8')

  // depth-1-repo — group should be "(root)"
  await makeRepo('depth-1-repo')
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('auditRepo', () => {
  it('returns the full status shape with exact key set', async () => {
    const result = await auditRepo(repoFor('alpha/clean'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.status).sort()).toEqual(
      ['ahead', 'behind', 'branch', 'detached', 'group', 'has_remote', 'has_upstream', 'iso_date', 'modified', 'name', 'path', 'rel_date', 'sha', 'subject', 'untracked'].sort()
    )
    expect(result.status.path).toBe('alpha/clean')
    expect(result.status.group).toBe('alpha')
    expect(result.status.name).toBe('clean')
    expect(result.status.branch).toBe('main')
    expect(result.status.detached).toBe(false)
    expect(result.status.modified).toBe(0)
    expect(result.status.untracked).toBe(0)
    expect(result.status.has_remote).toBe(false)
    expect(result.status.has_upstream).toBe(false)
    expect(result.status.ahead).toBe(0)
    expect(result.status.behind).toBe(0)
    expect(result.status.sha).toMatch(/^[0-9a-f]{7,}$/)
    expect(result.status.subject).toBe('initial')
    expect(result.status.iso_date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('counts modified and untracked separately', async () => {
    const result = await auditRepo(repoFor('alpha/dirty'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status.modified).toBeGreaterThan(0)
    expect(result.status.untracked).toBeGreaterThan(0)
  })

  it('flags detached HEAD with branch="detached@<sha>"', async () => {
    const result = await auditRepo(repoFor('alpha/detached'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status.detached).toBe(true)
    expect(result.status.branch.startsWith('detached@')).toBe(true)
    expect(result.status.branch).toBe(`detached@${result.status.sha}`)
  })

  it('reports has_remote=true and has_upstream=true for a tracked branch', async () => {
    const result = await auditRepo(repoFor('beta/with-remote'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status.has_remote).toBe(true)
    expect(result.status.has_upstream).toBe(true)
    expect(result.status.ahead).toBe(0)
    expect(result.status.behind).toBe(0)
  })

  it('returns an error entry for a corrupt repo (corrupt .git/HEAD)', async () => {
    const result = await auditRepo(repoFor('beta/corrupt'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.path).toBe('beta/corrupt')
    expect(typeof result.error.message).toBe('string')
    expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('passes through "(root)" group and the repo name from the scan envelope', async () => {
    const result = await auditRepo(repoFor('depth-1-repo', '(root)', 'depth-1-repo'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status.group).toBe('(root)')
    expect(result.status.name).toBe('depth-1-repo')
  })
})

describe('auditScan', () => {
  it('returns the expected top-level shape with sorted repos and aggregated errors', async () => {
    const scan = await scanRoot(tmpRoot, { max_depth: 2 })
    const result = await auditScan(scan, { include_stale_days: 30 })
    expect(Object.keys(result).sort()).toEqual(['audited_at', 'errors', 'repos', 'root', 'scanned_at'])
    expect(result.root).toBe(tmpRoot)
    expect(result.scanned_at).toBe(scan.scanned_at)
    expect(result.audited_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // 6 repos discovered, but beta/corrupt is broken — expect 5 healthy + 1 error.
    expect(result.repos.length).toBe(5)
    expect(result.errors?.length).toBe(1)
    expect(result.errors?.[0]?.path).toBe('beta/corrupt')

    // Sort: group asc, then name asc. "(root)" sorts before "alpha".
    const order = result.repos.map((r) => `${r.group}/${r.name}`)
    expect(order).toEqual(['(root)/depth-1-repo', 'alpha/clean', 'alpha/detached', 'alpha/dirty', 'beta/with-remote'])
  })

  it('omits the errors key when every repo audits cleanly', async () => {
    const scan = await scanRoot(path.join(tmpRoot, 'alpha'), { max_depth: 2 })
    const result = await auditScan(scan, { include_stale_days: 30 })
    expect(result.errors).toBeUndefined()
    expect(result.repos.length).toBeGreaterThan(0)
  })

  it('sorts multiple errors by path so the output is deterministic', async () => {
    // Stage a fresh tmp dir with two corrupt repos so the errors comparator gets to run.
    const errTmp = path.join(os.tmpdir(), 'mcp-git-audit-audit-errors', `run-${process.pid}`)
    await fs.rm(errTmp, { recursive: true, force: true })
    await fs.mkdir(errTmp, { recursive: true })
    try {
      for (const name of ['zeta', 'alpha']) {
        const dir = path.join(errTmp, name)
        await fs.mkdir(dir, { recursive: true })
        await git(dir, 'init', '-q', '-b', 'main')
        await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf-8')
        await git(dir, 'add', '.')
        await git(dir, 'commit', '-q', '-m', 'initial')
        await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'not a valid ref\n', 'utf-8')
      }
      const scan = await scanRoot(errTmp, { max_depth: 2 })
      const result = await auditScan(scan, { include_stale_days: 30 })
      expect(result.repos.length).toBe(0)
      expect(result.errors?.map((e) => e.path)).toEqual(['alpha', 'zeta'])
    } finally {
      await fs.rm(errTmp, { recursive: true, force: true })
    }
  })
})
