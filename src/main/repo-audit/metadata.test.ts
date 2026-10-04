import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveGitMetadata } from './metadata.js'

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

// Two sibling trees: `safe` is the only configured safe root, `outside` is not.
const base = path.join(os.tmpdir(), 'mcp-git-audit-metadata', `run-${process.pid}`)
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

/** A working directory whose `.git` is a pointer file with the given body. */
const pointerRepo = async (rel: string, body: string): Promise<string> => {
  const dir = path.join(safe, rel)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, '.git'), body, 'utf-8')
  return dir
}

const real = (p: string) => fs.realpath(p)

beforeAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
  await fs.mkdir(safe, { recursive: true })
  await fs.mkdir(outside, { recursive: true })

  // Ordinary repository plus an authorised linked worktree (absolute gitdir, relative commondir).
  const main = await makeRepo(path.join(safe, 'main'))
  await git(main, 'worktree', 'add', '-q', path.join(safe, 'wt-abs'), '-b', 'wt-abs')

  // Linked worktree of a repository that lives outside the safe roots.
  const foreign = await makeRepo(path.join(outside, 'foreign'))
  await git(foreign, 'worktree', 'add', '-q', path.join(safe, 'wt-escape'), '-b', 'wt-escape')
})

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('resolveGitMetadata', () => {
  it('accepts an ordinary repository with a .git directory', async () => {
    const meta = await resolveGitMetadata(SAFE_ROOTS, path.join(safe, 'main'))
    const wt = await real(path.join(safe, 'main'))
    expect(meta).toEqual({
      work_tree: wt,
      kind: 'directory',
      git_dir: path.join(wt, '.git'),
      common_dir: path.join(wt, '.git')
    })
  })

  it('accepts an authorised linked worktree and resolves its common directory', async () => {
    const meta = await resolveGitMetadata(SAFE_ROOTS, path.join(safe, 'wt-abs'))
    const mainGit = await real(path.join(safe, 'main', '.git'))
    expect(meta.kind).toBe('pointer')
    expect(meta.git_dir).toBe(path.join(mainGit, 'worktrees', 'wt-abs'))
    expect(meta.common_dir).toBe(mainGit)
  })

  it('resolves a relative gitdir pointer against the working directory', async () => {
    const dir = await pointerRepo('wt-rel', 'gitdir: ../main/.git/worktrees/wt-abs\n')
    const meta = await resolveGitMetadata(SAFE_ROOTS, dir)
    expect(meta.git_dir).toBe(await real(path.join(safe, 'main', '.git', 'worktrees', 'wt-abs')))
  })

  it('rejects a worktree whose gitdir lies outside the safe roots', async () => {
    await expect(resolveGitMetadata(SAFE_ROOTS, path.join(safe, 'wt-escape'))).rejects.toThrow(
      /unsupported Git metadata: gitdir target escapes the configured safe roots/
    )
  })

  it('rejects a gitdir inside the safe roots whose commondir escapes them', async () => {
    const meta = path.join(safe, 'meta-escape')
    await fs.mkdir(meta, { recursive: true })
    await fs.writeFile(path.join(meta, 'commondir'), `${path.join(outside, 'foreign', '.git')}\n`, 'utf-8')
    const dir = await pointerRepo('wt-common-escape', `gitdir: ${meta}\n`)
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(
      /commondir target escapes the configured safe roots/
    )
  })

  it('rejects a gitdir reached through a symlink that escapes the safe roots', async () => {
    await fs.symlink(path.join(outside, 'foreign', '.git'), path.join(safe, 'link-to-outside'))
    const dir = await pointerRepo('wt-symlink-escape', 'gitdir: ../link-to-outside\n')
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/gitdir target escapes the configured safe roots/)
  })

  it('rejects a dangling gitdir pointer', async () => {
    const dir = await pointerRepo('wt-dangling', 'gitdir: ../no-such-dir\n')
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/gitdir target does not exist/)
  })

  it('rejects a cyclic symlink gitdir pointer', async () => {
    await fs.symlink(path.join(safe, 'loop-b'), path.join(safe, 'loop-a'))
    await fs.symlink(path.join(safe, 'loop-a'), path.join(safe, 'loop-b'))
    const dir = await pointerRepo('wt-loop', 'gitdir: ../loop-a\n')
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/gitdir target is cyclic \(symlink loop\)/)
  })

  it('rejects a gitdir pointer at its own working tree', async () => {
    const dir = await pointerRepo('wt-self', 'gitdir: .\n')
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/points at its own working tree/)
  })

  it('rejects a gitdir pointer naming a file (pointer chains are not followed)', async () => {
    const dir = await pointerRepo('wt-chain', 'gitdir: ../wt-rel/.git\n')
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/gitdir target is not a directory/)
  })

  it.each([
    ['missing prefix', 'not a pointer\n'],
    ['empty target', 'gitdir: \n'],
    ['multiple lines', 'gitdir: ../main/.git\ngitdir: ../other\n'],
    ['empty file', '']
  ])('rejects a malformed pointer (%s)', async (label, body) => {
    const dir = await pointerRepo(`wt-malformed-${label.replace(/\s/g, '-')}`, body)
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/\.git pointer is malformed/)
  })

  it('rejects an oversized pointer file without reading it', async () => {
    const dir = await pointerRepo('wt-oversized', `gitdir: ${'x'.repeat(5000)}\n`)
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/exceeds 4096 bytes/)
  })

  it('rejects a commondir entry that is not a regular file', async () => {
    const meta = path.join(safe, 'meta-commondir-dir')
    await fs.mkdir(path.join(meta, 'commondir'), { recursive: true })
    const dir = await pointerRepo('wt-commondir-dir', `gitdir: ${meta}\n`)
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/commondir is not a regular file/)
  })

  it('rejects a dangling commondir target', async () => {
    const meta = path.join(safe, 'meta-commondir-dangling')
    await fs.mkdir(meta, { recursive: true })
    await fs.writeFile(path.join(meta, 'commondir'), '../no-such-common\n', 'utf-8')
    const dir = await pointerRepo('wt-commondir-dangling', `gitdir: ${meta}\n`)
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/commondir target does not exist/)
  })

  it('rejects a symlinked .git entry', async () => {
    const dir = path.join(safe, 'symlinked-dotgit')
    await fs.mkdir(dir, { recursive: true })
    await fs.symlink(path.join(safe, 'main', '.git'), path.join(dir, '.git'))
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/neither a directory nor a regular file/)
  })

  it('rejects a directory without a .git entry (no upward repository discovery)', async () => {
    const dir = path.join(safe, 'main', 'subdir')
    await fs.mkdir(dir, { recursive: true })
    await expect(resolveGitMetadata(SAFE_ROOTS, dir)).rejects.toThrow(/no \.git entry/)
  })

  it('rejects a missing working directory rather than auditing an ancestor', async () => {
    await expect(resolveGitMetadata(SAFE_ROOTS, path.join(safe, 'main', 'missing'))).rejects.toThrow(
      /repository directory does not exist/
    )
  })

  it('rejects a working directory outside the safe roots before reading it', async () => {
    await expect(resolveGitMetadata(SAFE_ROOTS, path.join(outside, 'foreign'))).rejects.toThrow(
      /not inside any configured safe_root/
    )
  })
})
