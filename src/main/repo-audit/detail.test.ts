import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { repoDetail } from './detail.js'

const execFileP = promisify(execFile)
const git = (cwd: string, ...args: string[]) =>
  execFileP('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'author@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'author@example.com'
    }
  })

// Config is injected, not read from env: tests pass an explicit safeRoots list
// scoped to the fixture root. Fixtures must live inside that root.
const TEST_ROOT = path.join(os.tmpdir(), 'mcp-git-audit-tests')
const SAFE_ROOTS: readonly string[] = [TEST_ROOT]
const tmpRoot = path.join(TEST_ROOT, 'detail', `run-${process.pid}`)

beforeAll(async () => {
  await fs.mkdir(TEST_ROOT, { recursive: true })
  await fs.rm(tmpRoot, { recursive: true, force: true })
  await fs.mkdir(tmpRoot, { recursive: true })

  // active — 6 commits + working-tree changes:
  //   ` M` file-1.txt (unstaged modify)
  //   ` D` file-2.txt (unstaged delete)
  //   `R ` file-3.txt -> renamed-3.txt (staged rename, exercises the rename branch in parseStatusZ)
  //   `??` new-file.txt (untracked)
  const active = path.join(tmpRoot, 'active')
  await fs.mkdir(active, { recursive: true })
  await git(active, 'init', '-q', '-b', 'main')
  await git(active, 'remote', 'add', 'origin', 'https://example.com/active.git')
  for (let i = 1; i <= 5; i++) {
    await fs.writeFile(path.join(active, `file-${i}.txt`), `commit ${i}\n`, 'utf-8')
    await git(active, 'add', '.')
    await git(active, 'commit', '-q', '-m', `commit ${i}`)
  }
  // 6th commit pairs a text change with a binary blob so --numstat emits both
  // a numeric `1\t0\tfile-6.txt` AND a `-\t-\tbinary.bin` row — exercises the
  // binary fallback branch in parseDiffstatLine.
  await fs.writeFile(path.join(active, 'file-6.txt'), 'commit 6\n', 'utf-8')
  await fs.writeFile(path.join(active, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 0, 0xff, 0]))
  await git(active, 'add', '.')
  await git(active, 'commit', '-q', '-m', 'commit 6')
  await fs.writeFile(path.join(active, 'file-1.txt'), 'modified\n', 'utf-8')
  await fs.rm(path.join(active, 'file-2.txt'))
  await git(active, 'mv', 'file-3.txt', 'renamed-3.txt')
  await fs.writeFile(path.join(active, 'new-file.txt'), 'new\n', 'utf-8')

  // empty — initialised but no commits (exercises the unborn-HEAD branch)
  const empty = path.join(tmpRoot, 'empty')
  await fs.mkdir(empty, { recursive: true })
  await git(empty, 'init', '-q', '-b', 'main')

  // corrupt — one commit, then HEAD overwritten with garbage so `git log` errors
  // with neither an unborn nor a timeout signature. Exercises the generic git
  // log failure branch.
  const corrupt = path.join(tmpRoot, 'corrupt')
  await fs.mkdir(corrupt, { recursive: true })
  await git(corrupt, 'init', '-q', '-b', 'main')
  await fs.writeFile(path.join(corrupt, 'README.md'), '# x\n', 'utf-8')
  await git(corrupt, 'add', '.')
  await git(corrupt, 'commit', '-q', '-m', 'initial')
  await fs.writeFile(path.join(corrupt, '.git', 'HEAD'), 'not a valid ref\n', 'utf-8')
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('repoDetail', () => {
  it('returns the requested number of commits, newest first, with files count populated', async () => {
    const result = await repoDetail(SAFE_ROOTS, path.join(tmpRoot, 'active'), { commits: 5, include_diffstat: false })
    expect(result.error).toBeUndefined()
    expect(result.commits.length).toBe(5)
    expect(result.commits[0]?.subject).toBe('commit 6')
    expect(result.commits[4]?.subject).toBe('commit 2')
    expect(result.path.endsWith('/active')).toBe(true)
    expect(result.abs_path.endsWith('/active')).toBe(true)
    expect(result.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.remote_url).toBe('https://example.com/active.git')
    for (const c of result.commits) {
      expect(c.sha).toMatch(/^[0-9a-f]{7,}$/)
      expect(c.author).toBe('Test Author')
      expect(c.iso_date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(c.rel_date.length).toBeGreaterThan(0)
      expect(c.files).toBeGreaterThan(0)
      expect(c.diffstat).toBeUndefined()
    }
  })

  it('clamps an out-of-range commits value (defence in depth — the schema also caps at 50)', async () => {
    const result = await repoDetail(SAFE_ROOTS, path.join(tmpRoot, 'active'), { commits: 999, include_diffstat: false })
    expect(result.commits.length).toBeLessThanOrEqual(50)
    expect(result.commits.length).toBe(6)
  })

  it('populates diffstat[] when include_diffstat=true; files matches diffstat.length; binary files report 0/0', async () => {
    const result = await repoDetail(SAFE_ROOTS, path.join(tmpRoot, 'active'), { commits: 3, include_diffstat: true })
    expect(result.commits.length).toBe(3)
    for (const c of result.commits) {
      expect(Array.isArray(c.diffstat)).toBe(true)
      expect(c.files).toBe(c.diffstat?.length ?? -1)
      for (const d of c.diffstat ?? []) {
        expect(typeof d.added).toBe('number')
        expect(typeof d.removed).toBe('number')
        expect(d.path.length).toBeGreaterThan(0)
      }
    }
    // The binary file in commit 6 surfaces as a numstat `-\t-\t<path>` row;
    // confirm we coerce both counts to 0 rather than NaN.
    const commit6 = result.commits.find((c) => c.subject === 'commit 6')
    const binary = commit6?.diffstat?.find((d) => d.path === 'binary.bin')
    expect(binary).toBeDefined()
    expect(binary?.added).toBe(0)
    expect(binary?.removed).toBe(0)
  })

  it('working_tree.modified length equals summary.modified + summary.untracked; status codes are raw porcelain', async () => {
    const result = await repoDetail(SAFE_ROOTS, path.join(tmpRoot, 'active'), { commits: 1, include_diffstat: false })
    const { modified, summary } = result.working_tree
    expect(modified.length).toBe(summary.modified + summary.untracked)
    expect(summary.modified).toBeGreaterThan(0)
    expect(summary.untracked).toBeGreaterThan(0)
    for (const entry of modified) {
      expect(entry.status.length).toBe(2)
    }
    // Confirm raw porcelain codes are preserved for downstream consumers.
    expect(modified.some((m) => m.status === '??')).toBe(true)
    expect(modified.some((m) => m.status[0] === 'R')).toBe(true)
    // The staged rename should surface its NEW path; the OLD path token must
    // not have been emitted as a separate entry.
    const renameEntry = modified.find((m) => m.status[0] === 'R')
    expect(renameEntry?.path).toBe('renamed-3.txt')
    expect(modified.some((m) => m.path === 'file-3.txt')).toBe(false)
  })

  it("returns commits: [] (not an error) for a freshly init'd repo with no commits", async () => {
    const result = await repoDetail(SAFE_ROOTS, path.join(tmpRoot, 'empty'), { commits: 10, include_diffstat: false })
    expect(result.commits).toEqual([])
    expect(result.error).toBeUndefined()
    expect(result.working_tree.modified).toEqual([])
    expect(result.remote_url).toBeNull()
  })

  it('surfaces a generic git log failure via the error field while still returning a result envelope', async () => {
    const result = await repoDetail(SAFE_ROOTS, path.join(tmpRoot, 'corrupt'), { commits: 5, include_diffstat: false })
    expect(result.commits).toEqual([])
    expect(result.error).toMatch(/git log failed:/)
    expect(result.abs_path.endsWith('/corrupt')).toBe(true)
  })

  it('rejects abs_path outside MCP_GIT_AUDIT_SAFE_ROOTS', async () => {
    await expect(repoDetail(SAFE_ROOTS, '/etc', { commits: 1, include_diffstat: false })).rejects.toThrow(
      /not inside any configured safe_root/
    )
  })

  it('rejects path-traversal-style escapes via ..', async () => {
    await expect(
      repoDetail(SAFE_ROOTS, path.join(tmpRoot, 'active', '..', '..', '..', '..'), { commits: 1, include_diffstat: false })
    ).rejects.toThrow(/not inside any configured safe_root/)
  })

  it('completes a typical 10-commit no-diffstat call well under 1s', async () => {
    const start = Date.now()
    const result = await repoDetail(SAFE_ROOTS, path.join(tmpRoot, 'active'), { commits: 10, include_diffstat: false })
    const elapsed = Date.now() - start
    expect(result.commits.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1000)
  })
})
