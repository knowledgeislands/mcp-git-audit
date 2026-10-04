import { execFile, execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditRepo } from './audit.js'
import { MAX_SUBMODULE_ENTRIES, stashSummary, submoduleSummary } from './summaries.js'

const execFileP = promisify(execFile)
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
}
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await execFileP('git', args, { cwd, env: GIT_ENV })).stdout

const base = path.join(os.tmpdir(), 'mcp-git-audit-summaries', `run-${process.pid}`)
const safe = path.join(base, 'safe')
const outside = path.join(base, 'outside')
const SAFE_ROOTS: readonly string[] = [safe]
const parent = path.join(safe, 'parent')
const ZERO = '0'.repeat(40)

const commitFile = async (dir: string, name: string, body: string): Promise<string> => {
  await fs.writeFile(path.join(dir, name), body, 'utf-8')
  await git(dir, 'add', name)
  await git(dir, 'commit', '-q', '-m', `add ${name}`)
  return (await git(dir, 'rev-parse', 'HEAD')).trim()
}

const makeRepo = async (dir: string): Promise<string> => {
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  return commitFile(dir, 'README.md', '# x\n')
}

const addGitlink = (repo: string, commit: string, p: string) =>
  git(repo, 'update-index', '--add', '--cacheinfo', `160000,${commit},${p}`)

/** Feed `git update-index --index-info` records (`<mode> <sha> <stage>\t<path>`). */
const indexInfo = (repo: string, lines: string[]) =>
  execFileSync('git', ['update-index', '--index-info'], { cwd: repo, env: GIT_ENV, input: `${lines.join('\n')}\n` })

let changedFirst: string
let changedSecond: string
let matchedHead: string

beforeAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
  await fs.mkdir(safe, { recursive: true })
  const foreignHead = await makeRepo(path.join(outside, 'foreign'))
  await makeRepo(parent)

  // matched: child HEAD equals the gitlink; the child carries its own nested gitlink, which must not be listed.
  const matched = path.join(parent, 'sub', 'matched')
  matchedHead = await makeRepo(matched)
  await addGitlink(matched, matchedHead, 'nested')
  await git(matched, 'commit', '-q', '-m', 'nested gitlink')
  matchedHead = (await git(matched, 'rev-parse', 'HEAD')).trim()
  await addGitlink(parent, matchedHead, 'sub/matched')

  // changed: gitlink at the first commit, child moved on.
  const changed = path.join(parent, 'sub', 'changed')
  changedFirst = await makeRepo(changed)
  await addGitlink(parent, changedFirst, 'sub/changed')
  changedSecond = await commitFile(changed, 'more.md', 'more\n')

  // dirty: matched but with an untracked file.
  const dirty = path.join(parent, 'sub', 'dirty')
  await addGitlink(parent, await makeRepo(dirty), 'sub/dirty')
  await fs.writeFile(path.join(dirty, 'scratch.txt'), 'x\n', 'utf-8')

  // corrupt-index: HEAD readable, status fails, so dirty is unknown.
  const corrupt = path.join(parent, 'sub', 'corrupt-index')
  await addGitlink(parent, await makeRepo(corrupt), 'sub/corrupt-index')

  // unborn: initialised child with no commits, so HEAD cannot be read.
  const unborn = path.join(parent, 'sub', 'unborn')
  await fs.mkdir(unborn, { recursive: true })
  await git(unborn, 'init', '-q', '-b', 'main')
  await addGitlink(parent, matchedHead, 'sub/unborn')

  // escape: child whose .git pointer names metadata outside the safe roots.
  const escaping = path.join(parent, 'sub', 'escape')
  await fs.mkdir(escaping, { recursive: true })
  await addGitlink(parent, foreignHead, 'sub/escape')

  // uninitialised: an empty directory, a missing directory, and unusual literal paths.
  await fs.mkdir(path.join(parent, 'sub', 'empty-dir'), { recursive: true })
  await addGitlink(parent, matchedHead, 'sub/empty-dir')
  await addGitlink(parent, matchedHead, 'sub/missing')
  await addGitlink(parent, matchedHead, 'sub/spaced name\twith tab')
  await addGitlink(parent, matchedHead, 'sub/line\nbreak')
  await git(parent, 'commit', '-q', '-m', 'gitlinks')

  // Two retained stashes in the parent.
  for (const n of [1, 2]) {
    await fs.writeFile(path.join(parent, 'README.md'), `# stash ${n}\n`, 'utf-8')
    await git(parent, 'stash', 'push', '-q', '-m', `secret subject ${n}`)
  }

  // Wire up the escaping pointer and corrupt index after the parent commit (which would refuse them).
  await fs.writeFile(path.join(escaping, '.git'), `gitdir: ${path.join(outside, 'foreign', '.git')}\n`, 'utf-8')
  await fs.writeFile(path.join(corrupt, '.git', 'index'), 'not an index', 'utf-8')
})

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('stashSummary', () => {
  it('counts retained stashes without exposing subjects', async () => {
    const summary = await stashSummary(parent)
    expect(summary).toEqual({ status: 'available', count: 2 })
    expect(JSON.stringify(summary)).not.toContain('secret subject')
  })

  it('reports zero for a repository without stashes', async () => {
    expect(await stashSummary(path.join(parent, 'sub', 'matched'))).toEqual({ status: 'available', count: 0 })
  })

  it('reports unavailable (never zero) when Git fails', async () => {
    const notRepo = path.join(base, 'not-a-repo')
    await fs.mkdir(notRepo, { recursive: true })
    const summary = await stashSummary(notRepo)
    expect(summary.status).toBe('unavailable')
    expect(summary.count).toBeNull()
    expect(summary.error).toMatch(/not a git repository/i)
  })
})

describe('submoduleSummary', () => {
  it('summarises first-level gitlinks sorted by literal path', async () => {
    const summary = await submoduleSummary(SAFE_ROOTS, parent)
    expect(summary.status).toBe('available')
    expect(summary.total).toBe(10)
    expect(summary.omitted).toBe(0)
    expect(summary.error).toBeUndefined()
    const byPath = Object.fromEntries(summary.entries.map((e) => [e.path, e]))
    expect(summary.entries.map((e) => e.path)).toEqual([
      'sub/changed',
      'sub/corrupt-index',
      'sub/dirty',
      'sub/empty-dir',
      'sub/escape',
      'sub/line\nbreak',
      'sub/matched',
      'sub/missing',
      'sub/spaced name\twith tab',
      'sub/unborn'
    ])
    expect(byPath['sub/matched']).toEqual({
      path: 'sub/matched',
      expected_commit: matchedHead,
      actual_commit: matchedHead,
      state: 'matched',
      dirty: false
    })
    expect(byPath['sub/changed']).toMatchObject({
      expected_commit: changedFirst,
      actual_commit: changedSecond,
      state: 'changed',
      dirty: false
    })
    expect(byPath['sub/dirty']).toMatchObject({ state: 'matched', dirty: true })
    expect(byPath['sub/corrupt-index']).toMatchObject({ state: 'matched', dirty: null })
    for (const p of ['sub/empty-dir', 'sub/missing', 'sub/spaced name\twith tab', 'sub/line\nbreak']) {
      expect(byPath[p]).toMatchObject({ state: 'uninitialised', actual_commit: null, dirty: null })
    }
    expect(byPath['sub/unborn']).toMatchObject({ state: 'unavailable', actual_commit: null, dirty: null })
    expect(byPath['sub/escape']).toMatchObject({ state: 'unavailable', actual_commit: null, dirty: null })
  })

  it('caps entries and counts the remainder as omitted', async () => {
    const many = path.join(safe, 'many')
    await makeRepo(many)
    const total = MAX_SUBMODULE_ENTRIES + 5
    indexInfo(
      many,
      Array.from({ length: total }, (_, i) => `160000 ${matchedHead} 0\tm/${String(i).padStart(3, '0')}`)
    )
    const summary = await submoduleSummary(SAFE_ROOTS, many)
    expect(summary.total).toBe(total)
    expect(summary.omitted).toBe(5)
    expect(summary.entries.length).toBe(MAX_SUBMODULE_ENTRIES)
    expect(summary.entries[0]?.path).toBe('m/000')
    expect(summary.entries.at(-1)?.path).toBe('m/099')
  })

  it('reports a conflicted gitlink as unavailable with its lowest-stage commit', async () => {
    const conflicted = path.join(safe, 'conflicted')
    const head = await makeRepo(conflicted)
    indexInfo(conflicted, [
      `160000 ${head} 1\tsub/x`,
      `160000 ${ZERO.replace(/0$/, '1')} 2\tsub/x`,
      `100644 ${head} 3\tsub/x`
    ])
    const summary = await submoduleSummary(SAFE_ROOTS, conflicted)
    expect(summary.total).toBe(1)
    expect(summary.entries).toEqual([
      { path: 'sub/x', expected_commit: head, actual_commit: null, state: 'unavailable', dirty: null }
    ])
  })

  it('reports unavailable (never zero) when the index cannot be listed', async () => {
    const summary = await submoduleSummary(SAFE_ROOTS, path.join(base, 'not-a-repo'))
    expect(summary).toEqual({
      status: 'unavailable',
      total: null,
      omitted: null,
      entries: [],
      error: expect.stringMatching(/not a git repository/i)
    })
  })
})

describe('auditRepo with submodules', () => {
  it('includes both summaries and keeps submodule changes out of the parent modified count', async () => {
    const result = await auditRepo({ path: 'parent', abs_path: parent, group: '(root)', name: 'parent' }, SAFE_ROOTS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status.stash).toEqual({ status: 'available', count: 2 })
    expect(result.status.submodules.total).toBe(10)
    // sub/changed and sub/dirty would otherwise appear as modified gitlinks.
    expect(result.status.modified).toBe(0)
  })
})
