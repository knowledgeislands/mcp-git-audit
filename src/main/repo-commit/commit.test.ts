import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CommitOptions, commitRepo } from './commit.js'

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

// Config is injected, not read from env: tests pass an explicit safeRoots list.
const TEST_ROOT = path.join(os.tmpdir(), 'mcp-git-audit-tests')
const SAFE_ROOTS: readonly string[] = [TEST_ROOT]
const tmpRoot = path.join(TEST_ROOT, 'commit', `run-${process.pid}`)

/** A repo with one commit (README.md) and a repository-local identity, as production git calls need. */
const makeRepo = async (name: string, { unborn = false } = {}): Promise<string> => {
  const dir = path.join(tmpRoot, name)
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await git(dir, 'config', 'user.name', 'test')
  await git(dir, 'config', 'user.email', 'test@example.com')
  if (!unborn) {
    await fs.writeFile(path.join(dir, 'README.md'), '# initial\n', 'utf-8')
    await git(dir, 'add', 'README.md')
    await git(dir, 'commit', '-q', '-m', 'initial')
  }
  return dir
}

const write = (repo: string, rel: string, content: string) => fs.writeFile(path.join(repo, rel), content, 'utf-8')
const head = async (repo: string) => (await git(repo, 'rev-parse', 'HEAD')).trim()
const indexBytes = (repo: string) => fs.readFile(path.join(repo, '.git', 'index'))
const stagedNames = async (repo: string) =>
  (await git(repo, 'diff', '--cached', '--name-only')).split('\n').filter(Boolean)
const committedNames = async (repo: string, rev = 'HEAD') =>
  (await git(repo, 'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', rev)).split('\n').filter(Boolean)
const tempIndexLeftovers = async (repo: string) =>
  (await fs.readdir(path.join(repo, '.git'))).filter((f) => f.startsWith('mcp-git-audit-index-'))
const writeHook = async (repo: string, name: string, body: string) => {
  const file = path.join(repo, '.git', 'hooks', name)
  await fs.writeFile(file, `#!/bin/sh\n${body}\n`, 'utf-8')
  await fs.chmod(file, 0o755)
}

const opts = (overrides: Partial<CommitOptions> & Pick<CommitOptions, 'paths'>): CommitOptions => ({
  message: 'test commit',
  stage: 'paths',
  dry_run: false,
  allow_empty: false,
  ...overrides
})

beforeAll(async () => {
  await fs.mkdir(TEST_ROOT, { recursive: true })
  await fs.rm(tmpRoot, { recursive: true, force: true })
  await fs.mkdir(tmpRoot, { recursive: true })
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('commitRepo stage="paths" in a shared tree', () => {
  it('commits only the named paths and preserves unrelated staged, unstaged and untracked work', async () => {
    const repo = await makeRepo('shared-tree')
    await write(repo, 'mine.txt', 'mine\n')
    await write(repo, 'theirs-staged.txt', 'staged by someone else\n')
    await git(repo, 'add', 'theirs-staged.txt')
    await write(repo, 'README.md', '# edited by someone else\n')
    await write(repo, 'theirs-untracked.txt', 'untracked\n')
    const stagedEntryBefore = await git(repo, 'ls-files', '-s', 'theirs-staged.txt')
    const before = await head(repo)

    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['mine.txt'] }))

    expect(result).toMatchObject({
      ok: true,
      error: null,
      stage: 'paths',
      staged_paths: ['mine.txt'],
      skipped_paths: [],
      rejected_paths: [],
      hook_modified_paths: [],
      command: 'git commit -m test commit'
    })
    expect(result.sha).toMatch(/^[0-9a-f]{7,}$/)
    expect(await committedNames(repo)).toEqual(['mine.txt'])
    expect((await git(repo, 'rev-parse', 'HEAD^')).trim()).toBe(before)
    // The other actor's staged entry survives byte-for-byte; the committed path is clean in the real index.
    expect(await git(repo, 'ls-files', '-s', 'theirs-staged.txt')).toBe(stagedEntryBefore)
    expect(await stagedNames(repo)).toEqual(['theirs-staged.txt'])
    const status = await git(repo, 'status', '--porcelain')
    expect(status).toContain(' M README.md')
    expect(status).toContain('?? theirs-untracked.txt')
    expect(status).not.toContain('mine.txt')
    expect(await tempIndexLeftovers(repo)).toEqual([])
  })

  it('commits the working-tree content of a named path that was pre-staged differently', async () => {
    const repo = await makeRepo('pre-staged-named')
    await write(repo, 'README.md', '# staged version\n')
    await git(repo, 'add', 'README.md')
    await write(repo, 'README.md', '# working version\n')
    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['README.md'] }))
    expect(result.ok).toBe(true)
    expect(await git(repo, 'show', 'HEAD:README.md')).toBe('# working version\n')
    expect(await stagedNames(repo)).toEqual([])
    expect(await git(repo, 'status', '--porcelain')).toBe('')
  })

  it('commits a tracked deletion and reports unchanged named paths as skipped', async () => {
    const repo = await makeRepo('deletion')
    await write(repo, 'keep.txt', 'keep\n')
    await git(repo, 'add', 'keep.txt')
    await git(repo, 'commit', '-q', '-m', 'add keep')
    await fs.rm(path.join(repo, 'README.md'))
    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['README.md', 'keep.txt', 'README.md'] }))
    expect(result).toMatchObject({ ok: true, staged_paths: ['README.md'], skipped_paths: ['keep.txt'] })
    expect(await committedNames(repo)).toEqual(['README.md'])
    expect(await git(repo, 'ls-files')).toBe('keep.txt\n')
  })

  it('refuses when every named path matches HEAD, unless allow_empty is set', async () => {
    const repo = await makeRepo('nothing-to-commit')
    const before = await head(repo)
    const refused = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['README.md'] }))
    expect(refused).toMatchObject({ ok: false, sha: null, staged_paths: [], skipped_paths: ['README.md'] })
    expect(refused.error).toMatch(/nothing to commit/)
    expect(await head(repo)).toBe(before)

    const empty = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['README.md'], allow_empty: true }))
    expect(empty).toMatchObject({ ok: true, command: 'git commit --allow-empty -m test commit' })
    expect(empty.sha).not.toBeNull()
    expect(await committedNames(repo)).toEqual([])
  })

  it('creates a root commit on an unborn branch', async () => {
    const repo = await makeRepo('unborn', { unborn: true })
    await write(repo, 'first.txt', 'first\n')
    await write(repo, 'other.txt', 'not mine\n')
    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['first.txt'] }))
    expect(result).toMatchObject({ ok: true, staged_paths: ['first.txt'] })
    expect(await committedNames(repo)).toEqual(['first.txt'])
    expect(await git(repo, 'status', '--porcelain')).toBe('?? other.txt\n')
  })
})

describe('commitRepo dry run', () => {
  it('leaves the real index byte-identical and HEAD unmoved', async () => {
    const repo = await makeRepo('dry-run')
    await write(repo, 'a.txt', 'a\n')
    await write(repo, 'b.txt', 'b\n')
    await git(repo, 'add', 'b.txt')
    await write(repo, 'README.md', '# changed\n')
    const indexBefore = await indexBytes(repo)
    const before = await head(repo)

    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['a.txt', 'README.md'], dry_run: true }))

    expect(result).toMatchObject({
      ok: true,
      dry_run: true,
      sha: null,
      staged_paths: ['README.md', 'a.txt'],
      command: 'git commit --dry-run -m test commit'
    })
    expect(result.stdout).toContain('a.txt')
    expect(await head(repo)).toBe(before)
    expect((await indexBytes(repo)).equals(indexBefore)).toBe(true)
    expect(await tempIndexLeftovers(repo)).toEqual([])
  })
})

describe('commitRepo path validation', () => {
  it('rejects every invalid path at once and performs nothing', async () => {
    const repo = await makeRepo('path-errors')
    const outside = path.join(tmpRoot, 'path-errors-outside')
    await fs.mkdir(outside, { recursive: true })
    await write(outside, 'file.txt', 'outside\n')
    await fs.symlink(outside, path.join(repo, 'link'))
    await fs.mkdir(path.join(repo, 'dir'))
    await write(repo, 'dir/inner.txt', 'inner\n')
    await write(repo, '.gitignore', '*.log\n')
    await write(repo, 'ignored.log', 'ignored\n')
    await write(repo, 'README.md', '# would be valid\n')
    const indexBefore = await indexBytes(repo)
    const before = await head(repo)
    const bad = [
      '',
      'x'.repeat(4097),
      'a\nb',
      '-rf',
      '/etc/passwd',
      ':(glob)*.md',
      '*.md',
      'a?.txt',
      '[ab].txt',
      '../escape',
      'dir/../README.md',
      'dir//inner.txt',
      './README.md',
      'dir/',
      '.git/config',
      'sub/.GIT/x',
      'dir',
      'link/file.txt',
      'missing.txt',
      'no-such-dir/missing.txt',
      'README.md/child',
      'ignored.log'
    ]

    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: [...bad, 'README.md'] }))

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/22 path\(s\) rejected/)
    expect(result.rejected_paths.map((r) => r.path)).toEqual(bad)
    const reasons = Object.fromEntries(result.rejected_paths.map((r) => [r.path, r.reason]))
    expect(reasons['']).toMatch(/1-4096/)
    expect(reasons['a\nb']).toMatch(/NUL or newline/)
    expect(reasons['-rf']).toMatch(/start with "-"/)
    expect(reasons['/etc/passwd']).toMatch(/not absolute/)
    expect(reasons['*.md']).toMatch(/pathspec magic/)
    expect(reasons['../escape']).toMatch(/"\.\." segments/)
    expect(reasons['./README.md']).toMatch(/normalised/)
    expect(reasons['sub/.GIT/x']).toMatch(/Git metadata/)
    expect(reasons.dir).toMatch(/is a directory/)
    expect(reasons['link/file.txt']).toMatch(/beyond a symbolic link/)
    expect(reasons['missing.txt']).toMatch(/neither present/)
    expect(reasons['README.md/child']).toMatch(/neither present/)
    expect(reasons['ignored.log']).toMatch(/ignored and untracked/)
    expect(result.sha).toBeNull()
    expect(await head(repo)).toBe(before)
    expect((await indexBytes(repo)).equals(indexBefore)).toBe(true)
    expect(await tempIndexLeftovers(repo)).toEqual([])
  })

  it('throws on input-shape errors before touching the repository', async () => {
    const repo = await makeRepo('input-errors')
    await expect(commitRepo(SAFE_ROOTS, repo, opts({ paths: ['README.md'], message: '' }))).rejects.toThrow(
      /must not be empty/
    )
    await expect(commitRepo(SAFE_ROOTS, repo, opts({ paths: ['README.md'], message: 'a\nb' }))).rejects.toThrow(
      /single line/
    )
    await expect(commitRepo(SAFE_ROOTS, repo, opts({ paths: [] }))).rejects.toThrow(/paths is required/)
  })

  it('throws for a directory that is not a repository without blocking later calls', async () => {
    const dir = path.join(tmpRoot, 'not-a-repo')
    await fs.mkdir(dir, { recursive: true })
    await write(dir, 'a.txt', 'a\n')
    await expect(commitRepo(SAFE_ROOTS, dir, opts({ paths: ['a.txt'] }))).rejects.toThrow(/not a git repository/)
    await expect(commitRepo(SAFE_ROOTS, dir, opts({ paths: ['a.txt'] }))).rejects.toThrow(/not a git repository/)
  })

  it('refuses while a merge is in progress', async () => {
    const repo = await makeRepo('merge-in-progress')
    await fs.writeFile(path.join(repo, '.git', 'MERGE_HEAD'), `${await head(repo)}\n`, 'utf-8')
    await write(repo, 'a.txt', 'a\n')
    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['a.txt'] }))
    expect(result).toMatchObject({ ok: false, sha: null })
    expect(result.error).toMatch(/merge is in progress/)
  })
})

describe('commitRepo stage="prepared_index"', () => {
  it('commits the prepared index when its staged set equals paths, leaving unstaged work alone', async () => {
    const repo = await makeRepo('prepared-equal')
    await write(repo, 'a.txt', 'a\n')
    await write(repo, 'b.txt', 'b staged\n')
    await git(repo, 'add', 'a.txt', 'b.txt')
    await write(repo, 'b.txt', 'b unstaged edit\n')
    await write(repo, 'README.md', '# unstaged\n')

    const result = await commitRepo(SAFE_ROOTS, repo, opts({ stage: 'prepared_index', paths: ['b.txt', 'a.txt'] }))

    expect(result).toMatchObject({ ok: true, staged_paths: ['a.txt', 'b.txt'], skipped_paths: [] })
    expect(await committedNames(repo)).toEqual(['a.txt', 'b.txt'])
    // The staged content, not the later working-tree edit, is what was committed.
    expect(await git(repo, 'show', 'HEAD:b.txt')).toBe('b staged\n')
    expect(await stagedNames(repo)).toEqual([])
    const status = await git(repo, 'status', '--porcelain')
    expect(status).toContain(' M README.md')
    expect(status).toContain(' M b.txt')
    expect(await tempIndexLeftovers(repo)).toEqual([])
  })

  it('refuses and lists extra and missing paths when the staged set differs', async () => {
    const repo = await makeRepo('prepared-mismatch')
    await write(repo, 'a.txt', 'a\n')
    await write(repo, 'b.txt', 'b\n')
    await write(repo, 'c.txt', 'c\n')
    await git(repo, 'add', 'a.txt', 'b.txt')
    const indexBefore = await indexBytes(repo)
    const before = await head(repo)

    const result = await commitRepo(SAFE_ROOTS, repo, opts({ stage: 'prepared_index', paths: ['a.txt', 'c.txt'] }))

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not equal paths/)
    expect(result.rejected_paths).toEqual([
      { path: 'b.txt', reason: 'staged but not named in paths' },
      { path: 'c.txt', reason: 'named in paths but not staged' }
    ])
    expect(await head(repo)).toBe(before)
    expect((await indexBytes(repo)).equals(indexBefore)).toBe(true)
    expect(await tempIndexLeftovers(repo)).toEqual([])
  })

  it('treats a missing real index as an empty staged set', async () => {
    const repo = await makeRepo('prepared-no-index', { unborn: true })
    await write(repo, 'a.txt', 'a\n')
    const result = await commitRepo(SAFE_ROOTS, repo, opts({ stage: 'prepared_index', paths: ['a.txt'] }))
    expect(result.rejected_paths).toEqual([{ path: 'a.txt', reason: 'named in paths but not staged' }])
  })
})

describe('commitRepo hooks and races', () => {
  it('reports a path added by a pre-commit hook with the SHA and does not rewrite the commit', async () => {
    const repo = await makeRepo('hook-adds')
    await writeHook(repo, 'pre-commit', 'echo sneaky > sneaky.txt\ngit add sneaky.txt')
    await write(repo, 'a.txt', 'a\n')
    const before = await head(repo)

    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['a.txt'] }))

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/hook changed it/)
    expect(result.hook_modified_paths).toEqual(['sneaky.txt'])
    expect(result.sha).not.toBeNull()
    expect((await head(repo)).startsWith(result.sha as string)).toBe(true)
    expect((await git(repo, 'rev-parse', 'HEAD^')).trim()).toBe(before)
    expect(await committedNames(repo)).toEqual(['a.txt', 'sneaky.txt'])
    expect(await tempIndexLeftovers(repo)).toEqual([])
  })

  it('returns ok:false when a pre-commit hook fails, leaving HEAD and the real index unchanged', async () => {
    const repo = await makeRepo('hook-fails')
    await writeHook(repo, 'pre-commit', 'echo "hook says no" >&2\nexit 1')
    await write(repo, 'a.txt', 'a\n')
    await write(repo, 'b.txt', 'b\n')
    await git(repo, 'add', 'b.txt')
    const indexBefore = await indexBytes(repo)
    const before = await head(repo)

    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['a.txt'] }))

    expect(result).toMatchObject({ ok: false, sha: null, staged_paths: ['a.txt'] })
    expect(result.error).toMatch(/git commit failed/)
    expect(result.stderr).toContain('hook says no')
    expect(await head(repo)).toBe(before)
    expect((await indexBytes(repo)).equals(indexBefore)).toBe(true)
    expect(await tempIndexLeftovers(repo)).toEqual([])
  })

  it('reports a commit whose real-index update failed without rewriting it', async () => {
    const repo = await makeRepo('index-locked')
    await writeHook(repo, 'post-commit', 'touch "$(git rev-parse --git-dir)/index.lock"')
    await write(repo, 'a.txt', 'a\n')
    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['a.txt'] }))
    await fs.rm(path.join(repo, '.git', 'index.lock'), { force: true })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/real index was not updated/)
    expect(result.sha).not.toBeNull()
    expect(await committedNames(repo)).toEqual(['a.txt'])
  })

  it('reports a HEAD that is not a child of the prepared HEAD after the commit', async () => {
    const repo = await makeRepo('post-commit-moves-head')
    await writeHook(
      repo,
      'post-commit',
      'n=$(git commit-tree "HEAD^{tree}" -p HEAD -m extra) && git update-ref HEAD "$n"'
    )
    await write(repo, 'a.txt', 'a\n')
    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['a.txt'] }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not a direct child of the prepared HEAD/)
    expect((await head(repo)).startsWith(result.sha as string)).toBe(true)
    expect(await git(repo, 'log', '-1', '--format=%s')).toBe('extra\n')
  })

  it('refuses when HEAD moves while the commit is being prepared', async () => {
    const repo = await makeRepo('head-moves')
    const other = (await git(repo, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'other')).trim()
    // A clean filter runs during `git add` into the temporary index - i.e. mid-preparation.
    await git(repo, 'config', 'filter.moveit.clean', `git update-ref HEAD ${other} && cat`)
    await write(repo, '.gitattributes', 'a.txt filter=moveit\n')
    await write(repo, 'a.txt', 'a\n')
    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['a.txt'] }))
    expect(result).toMatchObject({ ok: false, sha: null, staged_paths: ['a.txt'] })
    expect(result.error).toMatch(/HEAD moved/)
    expect(await head(repo)).toBe(other)
    expect(await tempIndexLeftovers(repo)).toEqual([])
  })

  it('returns ok:false when the temporary index cannot be prepared', async () => {
    const repo = await makeRepo('prepare-fails')
    await git(repo, 'config', 'filter.broken.clean', 'exit 1')
    await git(repo, 'config', 'filter.broken.required', 'true')
    await write(repo, '.gitattributes', 'a.txt filter=broken\n')
    await write(repo, 'a.txt', 'a\n')
    const result = await commitRepo(SAFE_ROOTS, repo, opts({ paths: ['a.txt'] }))
    expect(result).toMatchObject({ ok: false, sha: null })
    expect(result.error).toMatch(/preparing the temporary index failed/)
    expect(await tempIndexLeftovers(repo)).toEqual([])
  })

  it('serialises concurrent calls on one repository', async () => {
    const repo = await makeRepo('concurrent')
    await write(repo, 'a.txt', 'a\n')
    await write(repo, 'b.txt', 'b\n')
    const before = await head(repo)
    const [first, second] = await Promise.all([
      commitRepo(SAFE_ROOTS, repo, opts({ paths: ['a.txt'], message: 'first' })),
      commitRepo(SAFE_ROOTS, repo, opts({ paths: ['b.txt'], message: 'second' }))
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    // Entry order into the queue is not guaranteed, but the two commits must form a linear chain.
    expect((await git(repo, 'rev-list', '--count', `${before}..HEAD`)).trim()).toBe('2')
    expect((await git(repo, 'rev-list', '--merges', `${before}..HEAD`)).trim()).toBe('')
    const pathsOf = async (subject: string) =>
      (await git(repo, 'log', '--format=', '--name-only', `--grep=^${subject}$`, `${before}..HEAD`)).trim()
    expect(await pathsOf('first')).toBe('a.txt')
    expect(await pathsOf('second')).toBe('b.txt')
    expect(await git(repo, 'status', '--porcelain')).toBe('')
  })
})
