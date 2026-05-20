import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DIFF_MAX_LINES_CEILING, diffRepo } from './diff.js'

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

const TEST_ROOT = path.join(os.tmpdir(), 'mcp-git-audit-tests')
const tmpRoot = path.join(TEST_ROOT, 'diff', `run-${process.pid}`)

const makeRepo = async (name: string): Promise<string> => {
  const dir = path.join(tmpRoot, name)
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await fs.writeFile(path.join(dir, 'README.md'), '# initial\n', 'utf-8')
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-q', '-m', 'initial')
  return dir
}

beforeAll(async () => {
  await fs.mkdir(TEST_ROOT, { recursive: true })
  await fs.rm(tmpRoot, { recursive: true, force: true })
  await fs.mkdir(tmpRoot, { recursive: true })
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('diffRepo', () => {
  it('returns empty result when the working tree is clean', async () => {
    const repo = await makeRepo('clean')
    const r = await diffRepo(repo, { staged: false, max_lines: 500 })
    expect(r.files).toEqual([])
    expect(r.total_additions).toBe(0)
    expect(r.total_deletions).toBe(0)
    expect(r.truncated).toBe(false)
    expect(r.staged).toBe(false)
    expect(r.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('reports unstaged modifications with status, counts, and a unified diff body', async () => {
    const repo = await makeRepo('modified')
    await fs.writeFile(path.join(repo, 'README.md'), '# initial\nadded\n', 'utf-8')
    await fs.writeFile(path.join(repo, 'b.txt'), 'b\nb2\n', 'utf-8')
    await git(repo, 'add', 'b.txt')
    // b.txt is staged now — it should NOT appear in unstaged diff.
    const r = await diffRepo(repo, { staged: false, max_lines: 500 })
    expect(r.files.map((f) => f.path)).toEqual(['README.md'])
    const f = r.files[0]
    if (!f) throw new Error('expected README.md entry')
    expect(f.status).toBe('M')
    expect(f.additions).toBe(1)
    expect(f.deletions).toBe(0)
    expect(f.diff).toContain('diff --git')
    expect(f.diff).toContain('+added')
    expect(f.truncated).toBe(false)
    expect(r.total_additions).toBe(1)
    expect(r.total_deletions).toBe(0)
  })

  it('reports staged changes when staged=true', async () => {
    const repo = await makeRepo('staged')
    await fs.writeFile(path.join(repo, 'c.txt'), 'c\n', 'utf-8')
    await git(repo, 'add', 'c.txt')
    const r = await diffRepo(repo, { staged: true, max_lines: 500 })
    expect(r.staged).toBe(true)
    expect(r.files.map((f) => f.path)).toEqual(['c.txt'])
    expect(r.files[0]?.status).toBe('A')
    expect(r.files[0]?.additions).toBe(1)
  })

  it('limits the diff to specific paths', async () => {
    const repo = await makeRepo('paths')
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n', 'utf-8')
    await fs.writeFile(path.join(repo, 'b.txt'), 'b\n', 'utf-8')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'track')
    await fs.writeFile(path.join(repo, 'a.txt'), 'a-changed\n', 'utf-8')
    await fs.writeFile(path.join(repo, 'b.txt'), 'b-changed\n', 'utf-8')
    const r = await diffRepo(repo, { staged: false, paths: ['a.txt'], max_lines: 500 })
    expect(r.files.map((f) => f.path)).toEqual(['a.txt'])
  })

  it('handles a rename by keying entries on the new path', async () => {
    const repo = await makeRepo('rename')
    await git(repo, 'mv', 'README.md', 'docs.md')
    const r = await diffRepo(repo, { staged: true, max_lines: 500 })
    const entry = r.files.find((f) => f.path === 'docs.md')
    expect(entry).toBeDefined()
    expect(entry?.status.startsWith('R')).toBe(true)
  })

  it('truncates per-file diff and sets the file + top-level flag when the budget is exceeded', async () => {
    const repo = await makeRepo('truncate')
    await fs.writeFile(path.join(repo, 'big.txt'), 'seed\n', 'utf-8')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'track big')
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    await fs.writeFile(path.join(repo, 'big.txt'), `${lines}\n`, 'utf-8')
    const r = await diffRepo(repo, { staged: false, max_lines: 5 })
    expect(r.truncated).toBe(true)
    const big = r.files.find((f) => f.path === 'big.txt')
    expect(big?.truncated).toBe(true)
    expect(big?.diff).toBeNull()
  })

  it('coerces binary file numstat dashes to zero counts', async () => {
    const repo = await makeRepo('binary')
    // PNG header bytes are enough for git to classify this as binary.
    const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00])
    await fs.writeFile(path.join(repo, 'logo.png'), bin)
    await git(repo, 'add', 'logo.png')
    const r = await diffRepo(repo, { staged: true, max_lines: 500 })
    const entry = r.files.find((f) => f.path === 'logo.png')
    expect(entry).toBeDefined()
    expect(entry?.additions).toBe(0)
    expect(entry?.deletions).toBe(0)
  })

  it('rejects relative paths that escape or look like options', async () => {
    const repo = await makeRepo('reject-paths')
    await expect(diffRepo(repo, { staged: false, paths: ['../etc/passwd'], max_lines: 500 })).rejects.toThrow(/invalid path/)
    await expect(diffRepo(repo, { staged: false, paths: ['/etc/passwd'], max_lines: 500 })).rejects.toThrow(/invalid path/)
    await expect(diffRepo(repo, { staged: false, paths: ['-rf'], max_lines: 500 })).rejects.toThrow(/invalid path/)
    await expect(diffRepo(repo, { staged: false, paths: ['foo/../bar'], max_lines: 500 })).rejects.toThrow(/invalid path/)
  })

  it('clamps an out-of-range max_lines into [1, ceiling]', async () => {
    const repo = await makeRepo('clamp')
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n', 'utf-8')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'track')
    await fs.writeFile(path.join(repo, 'a.txt'), 'a-changed\n', 'utf-8')
    // 0 should be clamped to 1 — but a single-line file diff has more than 1 line of header,
    // so we expect truncation rather than the file's full diff. Verify it doesn't crash.
    const r1 = await diffRepo(repo, { staged: false, max_lines: 0 })
    expect(r1.files[0]?.truncated).toBe(true)
    // Above ceiling — should clamp down without throwing.
    const r2 = await diffRepo(repo, { staged: false, max_lines: DIFF_MAX_LINES_CEILING + 999 })
    expect(r2.files[0]?.truncated).toBe(false)
  })

  it('wraps git failures with a "git diff failed:" prefix', async () => {
    const notARepo = path.join(tmpRoot, 'not-a-repo')
    await fs.mkdir(notARepo, { recursive: true })
    await expect(diffRepo(notARepo, { staged: false, max_lines: 500 })).rejects.toThrow(/git diff failed:/)
  })
})
