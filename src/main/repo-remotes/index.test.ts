import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addRemote, listRemotes, removeRemote, setRemoteUrl } from './index.js'

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
const tmpRoot = path.join(TEST_ROOT, 'remotes', `run-${process.pid}`)

const makeRepoWithRemote = async (name: string, remoteName: string, remoteUrl: string): Promise<string> => {
  const dir = path.join(tmpRoot, name)
  await fs.mkdir(dir, { recursive: true })
  await git(dir, 'init', '-q', '-b', 'main')
  await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf-8')
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-q', '-m', 'initial')
  await git(dir, 'remote', 'add', remoteName, remoteUrl)
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

describe('listRemotes', () => {
  it('returns sorted entries with fetch/push URLs and an ISO timestamp', async () => {
    const repo = await makeRepoWithRemote('listed', 'origin', 'https://example.com/foo.git')
    await git(repo, 'remote', 'add', 'aux', 'https://example.com/aux.git')
    const result = await listRemotes(SAFE_ROOTS, repo)
    // abs_path is the realpath — on macOS /var is a symlink to /private/var.
    const repoReal = await fs.realpath(repo)
    expect(result.abs_path).toBe(repoReal)
    expect(result.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.remotes.map((r) => r.name)).toEqual(['aux', 'origin'])
    expect(result.remotes[0]?.fetch_url).toBe('https://example.com/aux.git')
    expect(result.remotes[0]?.push_url).toBe('https://example.com/aux.git')
  })

  it('reports diverging fetch/push URLs after `set-url --push`', async () => {
    const repo = await makeRepoWithRemote('split-urls', 'origin', 'https://example.com/foo.git')
    await git(repo, 'remote', 'set-url', '--push', 'origin', 'https://example.com/foo-push.git')
    const result = await listRemotes(SAFE_ROOTS, repo)
    expect(result.remotes[0]?.fetch_url).toBe('https://example.com/foo.git')
    expect(result.remotes[0]?.push_url).toBe('https://example.com/foo-push.git')
  })

  it('returns [] for a repo with no remotes', async () => {
    const dir = path.join(tmpRoot, 'no-remotes')
    await fs.mkdir(dir, { recursive: true })
    await git(dir, 'init', '-q', '-b', 'main')
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n', 'utf-8')
    await git(dir, 'add', '.')
    await git(dir, 'commit', '-q', '-m', 'initial')
    const result = await listRemotes(SAFE_ROOTS, dir)
    expect(result.remotes).toEqual([])
  })

  it('redacts user:pass@ credentials in fetch/push URLs, never leaking the raw token', async () => {
    const repo = await makeRepoWithRemote('creds', 'origin', 'https://user:tok3n@github.com/o/r.git')
    const result = await listRemotes(SAFE_ROOTS, repo)
    expect(result.remotes[0]?.fetch_url).toBe('https://<redacted>@github.com/o/r.git')
    expect(result.remotes[0]?.push_url).toBe('https://<redacted>@github.com/o/r.git')
    expect(JSON.stringify(result)).not.toContain('tok3n')
  })

  it('rejects abs_path outside the safe roots', async () => {
    await expect(listRemotes(SAFE_ROOTS, '/etc')).rejects.toThrow(/not inside any configured safe_root/)
  })
})

describe('setRemoteUrl', () => {
  it('previews on dry_run=true without changing the URL; before is populated, after is omitted', async () => {
    const repo = await makeRepoWithRemote('set-url-dry', 'origin', 'https://example.com/old.git')
    const result = await setRemoteUrl(SAFE_ROOTS, repo, { remote: 'origin', url: 'https://example.com/new.git', push: false, dry_run: true })
    expect(result.dry_run).toBe(true)
    expect(result.before?.fetch_url).toBe('https://example.com/old.git')
    expect(result.after).toBeUndefined()
    const remotes = await listRemotes(SAFE_ROOTS, repo)
    expect(remotes.remotes[0]?.fetch_url).toBe('https://example.com/old.git')
  })

  it('changes the fetch URL on dry_run=false; running twice is idempotent', async () => {
    const repo = await makeRepoWithRemote('set-url-real', 'origin', 'https://example.com/old.git')
    const first = await setRemoteUrl(SAFE_ROOTS, repo, { remote: 'origin', url: 'https://example.com/new.git', push: false, dry_run: false })
    expect(first.dry_run).toBe(false)
    expect(first.after?.fetch_url).toBe('https://example.com/new.git')
    const second = await setRemoteUrl(SAFE_ROOTS, repo, { remote: 'origin', url: 'https://example.com/new.git', push: false, dry_run: false })
    expect(second.after?.fetch_url).toBe('https://example.com/new.git')
    expect(second.before?.fetch_url).toBe('https://example.com/new.git')
  })

  it('changes only the push URL when push=true', async () => {
    const repo = await makeRepoWithRemote('set-url-push', 'origin', 'https://example.com/fetch.git')
    const result = await setRemoteUrl(SAFE_ROOTS, repo, { remote: 'origin', url: 'https://example.com/push.git', push: true, dry_run: false })
    expect(result.after?.fetch_url).toBe('https://example.com/fetch.git')
    expect(result.after?.push_url).toBe('https://example.com/push.git')
  })

  it('rejects when the remote does not exist', async () => {
    const repo = await makeRepoWithRemote('set-url-missing', 'origin', 'https://example.com/foo.git')
    await expect(setRemoteUrl(SAFE_ROOTS, repo, { remote: 'nope', url: 'https://example.com/bar.git', push: false, dry_run: false })).rejects.toThrow(/does not exist/)
  })
})

describe('addRemote', () => {
  it('previews on dry_run=true', async () => {
    const repo = await makeRepoWithRemote('add-dry', 'origin', 'https://example.com/origin.git')
    const result = await addRemote(SAFE_ROOTS, repo, { remote: 'fork', url: 'https://example.com/fork.git', dry_run: true })
    expect(result.dry_run).toBe(true)
    expect(result.after).toBeUndefined()
    const remotes = await listRemotes(SAFE_ROOTS, repo)
    expect(remotes.remotes.map((r) => r.name)).toEqual(['origin'])
  })

  it('creates a new remote on dry_run=false; second call rejects', async () => {
    const repo = await makeRepoWithRemote('add-real', 'origin', 'https://example.com/origin.git')
    const result = await addRemote(SAFE_ROOTS, repo, { remote: 'fork', url: 'https://example.com/fork.git', dry_run: false })
    expect(result.after?.fetch_url).toBe('https://example.com/fork.git')
    await expect(addRemote(SAFE_ROOTS, repo, { remote: 'fork', url: 'https://example.com/fork2.git', dry_run: false })).rejects.toThrow(/already exists/)
  })
})

describe('removeRemote', () => {
  it('previews on dry_run=true without removing', async () => {
    const repo = await makeRepoWithRemote('rm-dry', 'origin', 'https://example.com/origin.git')
    const result = await removeRemote(SAFE_ROOTS, repo, { remote: 'origin', dry_run: true })
    expect(result.dry_run).toBe(true)
    expect(result.before?.fetch_url).toBe('https://example.com/origin.git')
    const remotes = await listRemotes(SAFE_ROOTS, repo)
    expect(remotes.remotes).toHaveLength(1)
  })

  it('removes the remote on dry_run=false; second call rejects', async () => {
    const repo = await makeRepoWithRemote('rm-real', 'origin', 'https://example.com/origin.git')
    const result = await removeRemote(SAFE_ROOTS, repo, { remote: 'origin', dry_run: false })
    expect(result.dry_run).toBe(false)
    expect(result.before?.fetch_url).toBe('https://example.com/origin.git')
    const remotes = await listRemotes(SAFE_ROOTS, repo)
    expect(remotes.remotes).toEqual([])
    await expect(removeRemote(SAFE_ROOTS, repo, { remote: 'origin', dry_run: false })).rejects.toThrow(/does not exist/)
  })
})
