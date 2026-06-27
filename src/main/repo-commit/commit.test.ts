import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commitRepo } from './commit.js'

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

// Config is injected, not read from env: tests pass an explicit safeRoots list.
const TEST_ROOT = path.join(os.tmpdir(), 'mcp-git-audit-tests')
const SAFE_ROOTS: readonly string[] = [TEST_ROOT]
const tmpRoot = path.join(TEST_ROOT, 'commit', `run-${process.pid}`)

const makeRepo = async (name: string): Promise<string> => {
  const dir = path.join(tmpRoot, name)
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await fs.writeFile(path.join(dir, 'README.md'), '# initial\n', 'utf-8')
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-q', '-m', 'initial')
  await git(dir, 'config', 'user.name', 'test')
  await git(dir, 'config', 'user.email', 'test@example.com')
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

describe('commitRepo', () => {
  it('stages all tracked modifications and creates a real commit when dry_run=false', async () => {
    const repo = await makeRepo('all-tracked-real')
    await fs.writeFile(path.join(repo, 'README.md'), '# updated\n', 'utf-8')
    const result = await commitRepo(SAFE_ROOTS, repo, {
      message: 'update readme',
      stage: 'all_tracked',
      dry_run: false,
      allow_empty: false
    })
    expect(result.dry_run).toBe(false)
    expect(result.stage).toBe('all_tracked')
    expect(result.staged_paths).toContain('README.md')
    expect(result.command).toBe('git commit -m update readme')
    expect(result.sha).toMatch(/^[0-9a-f]{7,}$/)
    // Confirm HEAD advanced and message is recorded.
    const { stdout } = await git(repo, 'log', '-1', '--pretty=format:%s')
    expect(stdout).toBe('update readme')
  })

  it('previews via --dry-run when dry_run=true and reports null SHA', async () => {
    const repo = await makeRepo('dry-run')
    await fs.writeFile(path.join(repo, 'README.md'), '# changed\n', 'utf-8')
    const headBefore = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim()
    const result = await commitRepo(SAFE_ROOTS, repo, { message: 'preview', stage: 'all_tracked', dry_run: true, allow_empty: false })
    expect(result.dry_run).toBe(true)
    expect(result.sha).toBeNull()
    expect(result.command).toBe('git commit --dry-run -m preview')
    // HEAD must not have moved.
    const headAfter = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim()
    expect(headAfter).toBe(headBefore)
  })

  it('stage="all" pulls in untracked files', async () => {
    const repo = await makeRepo('stage-all')
    await fs.writeFile(path.join(repo, 'new.txt'), 'new\n', 'utf-8')
    const result = await commitRepo(SAFE_ROOTS, repo, { message: 'add new', stage: 'all', dry_run: false, allow_empty: false })
    expect(result.staged_paths).toContain('new.txt')
    expect(result.sha).not.toBeNull()
  })

  it('stage="paths" only stages the listed paths', async () => {
    const repo = await makeRepo('stage-paths')
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n', 'utf-8')
    await fs.writeFile(path.join(repo, 'b.txt'), 'b\n', 'utf-8')
    const result = await commitRepo(SAFE_ROOTS, repo, {
      message: 'add a only',
      stage: 'paths',
      paths: ['a.txt'],
      dry_run: false,
      allow_empty: false
    })
    expect(result.staged_paths).toEqual(['a.txt'])
    // b.txt should still be untracked.
    const { stdout } = await git(repo, 'status', '--porcelain')
    expect(stdout).toContain('?? b.txt')
  })

  it('stage="none" commits the existing index without staging anything', async () => {
    const repo = await makeRepo('stage-none')
    await fs.writeFile(path.join(repo, 'c.txt'), 'c\n', 'utf-8')
    await git(repo, 'add', 'c.txt')
    const result = await commitRepo(SAFE_ROOTS, repo, { message: 'commit pre-staged', stage: 'none', dry_run: false, allow_empty: false })
    expect(result.staged_paths).toEqual(['c.txt'])
    expect(result.command).toBe('git commit -m commit pre-staged')
  })

  it('rejects when stage="paths" but no paths are given', async () => {
    const repo = await makeRepo('paths-required')
    await expect(commitRepo(SAFE_ROOTS, repo, { message: 'x', stage: 'paths', dry_run: true, allow_empty: false })).rejects.toThrow(
      /paths is required/
    )
  })

  it('rejects when paths are given for a non-paths stage mode', async () => {
    const repo = await makeRepo('paths-mismatch')
    await expect(
      commitRepo(SAFE_ROOTS, repo, { message: 'x', stage: 'all_tracked', paths: ['README.md'], dry_run: true, allow_empty: false })
    ).rejects.toThrow(/only allowed when stage="paths"/)
  })

  it('rejects relative paths that escape or look like options', async () => {
    const repo = await makeRepo('reject-paths')
    await expect(
      commitRepo(SAFE_ROOTS, repo, { message: 'x', stage: 'paths', paths: ['../etc/passwd'], dry_run: true, allow_empty: false })
    ).rejects.toThrow(/invalid path/)
    await expect(
      commitRepo(SAFE_ROOTS, repo, { message: 'x', stage: 'paths', paths: ['-rf'], dry_run: true, allow_empty: false })
    ).rejects.toThrow(/invalid path/)
    await expect(
      commitRepo(SAFE_ROOTS, repo, { message: 'x', stage: 'paths', paths: ['/abs/path'], dry_run: true, allow_empty: false })
    ).rejects.toThrow(/invalid path/)
    await expect(
      commitRepo(SAFE_ROOTS, repo, { message: 'x', stage: 'paths', paths: ['foo/../bar'], dry_run: true, allow_empty: false })
    ).rejects.toThrow(/invalid path/)
  })

  it('rejects an empty message', async () => {
    const repo = await makeRepo('empty-msg')
    await expect(commitRepo(SAFE_ROOTS, repo, { message: '', stage: 'all_tracked', dry_run: true, allow_empty: false })).rejects.toThrow(
      /must not be empty/
    )
  })

  it('rejects a multi-line message', async () => {
    const repo = await makeRepo('multiline-msg')
    await expect(
      commitRepo(SAFE_ROOTS, repo, { message: 'line1\nline2', stage: 'all_tracked', dry_run: true, allow_empty: false })
    ).rejects.toThrow(/single line/)
  })

  it('refuses to create an empty commit by default (allow_empty=false)', async () => {
    const repo = await makeRepo('empty-default')
    await expect(commitRepo(SAFE_ROOTS, repo, { message: 'empty', stage: 'none', dry_run: false, allow_empty: false })).rejects.toThrow(
      /git commit failed:/
    )
  })

  it('creates an empty commit when allow_empty=true', async () => {
    const repo = await makeRepo('empty-allow')
    const result = await commitRepo(SAFE_ROOTS, repo, { message: 'empty', stage: 'none', dry_run: false, allow_empty: true })
    expect(result.command).toBe('git commit --allow-empty -m empty')
    expect(result.sha).not.toBeNull()
  })

  it('wraps an add-stage failure with a "git add failed:" prefix', async () => {
    const repo = await makeRepo('add-fail')
    // Reference a nonexistent path so `git add -- nonexistent` exits non-zero.
    await expect(
      commitRepo(SAFE_ROOTS, repo, { message: 'x', stage: 'paths', paths: ['no-such-file.txt'], dry_run: false, allow_empty: false })
    ).rejects.toThrow(/git add failed:/)
  })
})
