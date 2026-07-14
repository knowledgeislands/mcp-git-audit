import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchRepo, pullRepo, pushRepo } from './index.js'

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
const tmpRoot = path.join(TEST_ROOT, 'sync', `run-${process.pid}`)

// --- helpers ---------------------------------------------------------------

const makeBareUpstream = async (name: string): Promise<string> => {
  const bare = path.join(tmpRoot, `${name}.git`)
  await fs.mkdir(bare, { recursive: true })
  await git(bare, 'init', '-q', '--bare', '-b', 'main')
  return bare
}

const makeRepoWithUpstream = async (name: string): Promise<{ repo: string; bare: string }> => {
  const repo = path.join(tmpRoot, name)
  const bare = await makeBareUpstream(`${name}-upstream`)
  await fs.mkdir(repo, { recursive: true })
  await git(repo, 'init', '-q', '-b', 'main')
  // Set repo-local identity so production git operations (e.g. pullRepo's rebase,
  // which spawns git without the test helper's identity env vars) have a committer
  // in CI, where no global git identity exists.
  await git(repo, 'config', 'user.name', 'test')
  await git(repo, 'config', 'user.email', 'test@example.com')
  await fs.writeFile(path.join(repo, 'README.md'), '# initial\n', 'utf-8')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-q', '-m', 'initial')
  await git(repo, 'remote', 'add', 'origin', bare)
  await git(repo, 'push', '-q', '-u', 'origin', 'main')
  return { repo, bare }
}

const cloneWorkingCopy = async (sourceBare: string, name: string): Promise<string> => {
  const dest = path.join(tmpRoot, name)
  await execFileP('git', ['clone', '-q', '-b', 'main', sourceBare, dest])
  await git(dest, 'config', 'user.name', 'test')
  await git(dest, 'config', 'user.email', 'test@example.com')
  return dest
}

beforeAll(async () => {
  await fs.mkdir(TEST_ROOT, { recursive: true })
  await fs.rm(tmpRoot, { recursive: true, force: true })
  await fs.mkdir(tmpRoot, { recursive: true })
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

// --- fetch -----------------------------------------------------------------

describe('fetchRepo', () => {
  it('fetches from the configured remote and emits the executed argv', async () => {
    const { repo, bare } = await makeRepoWithUpstream('fetch-basic')
    // Add a second commit via a sibling clone, push it up, then fetch into `repo`.
    const sibling = await cloneWorkingCopy(bare, 'fetch-basic-sibling')
    await fs.writeFile(path.join(sibling, 'a.txt'), 'one\n', 'utf-8')
    await git(sibling, 'add', '.')
    await git(sibling, 'commit', '-q', '-m', 'second')
    await git(sibling, 'push', '-q', 'origin', 'main')

    const result = await fetchRepo(SAFE_ROOTS, repo, { remote: 'origin', prune: false, tags: false, all_remotes: false, dry_run: false })
    expect(result.dry_run).toBe(false)
    expect(result.remote).toBe('origin')
    expect(result.command).toBe('git fetch -- origin')
    // Confirm FETCH_HEAD actually moved by reading a now-fetched object.
    const { stdout: shaOut } = await git(repo, 'rev-parse', 'origin/main')
    const { stdout: bareShaOut } = await git(bare, 'rev-parse', 'main')
    expect(shaOut.trim()).toBe(bareShaOut.trim())
  })

  it('passes through --prune, --tags, --dry-run, and --all', async () => {
    const { repo } = await makeRepoWithUpstream('fetch-flags')
    const result = await fetchRepo(SAFE_ROOTS, repo, { remote: 'origin', prune: true, tags: true, all_remotes: true, dry_run: true })
    expect(result.command).toBe('git fetch --prune --tags --dry-run --all')
    expect(result.all_remotes).toBe(true)
    expect(result.prune).toBe(true)
    expect(result.tags).toBe(true)
  })

  it('wraps git failures with a "git fetch failed:" prefix', async () => {
    const { repo } = await makeRepoWithUpstream('fetch-fail')
    await expect(
      fetchRepo(SAFE_ROOTS, repo, { remote: 'no-such-remote', prune: false, tags: false, all_remotes: false, dry_run: false })
    ).rejects.toThrow(/git fetch failed:/)
  })
})

// --- pull ------------------------------------------------------------------

describe('pullRepo', () => {
  it('rejects ff_only=true with rebase=true', async () => {
    const { repo } = await makeRepoWithUpstream('pull-mutex')
    await expect(
      pullRepo(SAFE_ROOTS, repo, { remote: 'origin', rebase: true, ff_only: true, autostash: false, dry_run: false })
    ).rejects.toThrow(/mutually exclusive/)
  })

  it('rejects detached HEAD without an explicit branch', async () => {
    const { repo } = await makeRepoWithUpstream('pull-detached')
    // Add a second commit so HEAD~1 has something to detach onto.
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n', 'utf-8')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'second')
    const { stdout } = await git(repo, 'rev-parse', 'HEAD~1')
    await git(repo, 'checkout', '-q', stdout.trim())
    await expect(
      pullRepo(SAFE_ROOTS, repo, { remote: 'origin', rebase: false, ff_only: true, autostash: false, dry_run: false })
    ).rejects.toThrow(/detached HEAD/)
  })

  it('approximates dry_run via git fetch --dry-run and reports the executed argv', async () => {
    const { repo } = await makeRepoWithUpstream('pull-dry')
    const result = await pullRepo(SAFE_ROOTS, repo, { remote: 'origin', rebase: false, ff_only: true, autostash: false, dry_run: true })
    expect(result.dry_run).toBe(true)
    expect(result.command).toBe('git fetch --dry-run -- origin main')
  })

  it('wraps a dry_run fetch failure with the dry-run prefix', async () => {
    const { repo } = await makeRepoWithUpstream('pull-dry-fail')
    await expect(
      pullRepo(SAFE_ROOTS, repo, { remote: 'no-such', rebase: false, ff_only: true, autostash: false, dry_run: true })
    ).rejects.toThrow(/pull dry-run/)
  })

  it('runs a real fast-forward pull with --ff-only and brings the working tree up to date', async () => {
    const { repo, bare } = await makeRepoWithUpstream('pull-ff')
    const sibling = await cloneWorkingCopy(bare, 'pull-ff-sibling')
    await fs.writeFile(path.join(sibling, 'b.txt'), 'b\n', 'utf-8')
    await git(sibling, 'add', '.')
    await git(sibling, 'commit', '-q', '-m', 'b')
    await git(sibling, 'push', '-q', 'origin', 'main')

    const result = await pullRepo(SAFE_ROOTS, repo, { remote: 'origin', rebase: false, ff_only: true, autostash: false, dry_run: false })
    expect(result.dry_run).toBe(false)
    expect(result.command).toBe('git pull --ff-only -- origin main')
    const exists = await fs
      .stat(path.join(repo, 'b.txt'))
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it('runs a rebase pull when rebase=true and ff_only=false (with autostash)', async () => {
    const { repo, bare } = await makeRepoWithUpstream('pull-rebase')
    // Set up local divergent commit (rebase target).
    await fs.writeFile(path.join(repo, 'local.txt'), 'local\n', 'utf-8')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'local commit')
    // Upstream commit via sibling.
    const sibling = await cloneWorkingCopy(bare, 'pull-rebase-sibling')
    await fs.writeFile(path.join(sibling, 'remote.txt'), 'remote\n', 'utf-8')
    await git(sibling, 'add', '.')
    await git(sibling, 'commit', '-q', '-m', 'remote commit')
    await git(sibling, 'push', '-q', 'origin', 'main')

    // Leave an unstaged change so --autostash gets exercised.
    await fs.writeFile(path.join(repo, 'README.md'), '# changed\n', 'utf-8')

    const result = await pullRepo(SAFE_ROOTS, repo, {
      remote: 'origin',
      branch: 'main',
      rebase: true,
      ff_only: false,
      autostash: true,
      dry_run: false
    })
    expect(result.command).toBe('git pull --rebase --autostash -- origin main')
    // Both commits should now be in history.
    const { stdout } = await git(repo, 'log', '--pretty=format:%s')
    expect(stdout).toContain('local commit')
    expect(stdout).toContain('remote commit')
  })

  it('wraps a real-pull failure with a "git pull failed:" prefix', async () => {
    const { repo } = await makeRepoWithUpstream('pull-fail')
    await expect(
      pullRepo(SAFE_ROOTS, repo, { remote: 'no-such', rebase: false, ff_only: true, autostash: false, dry_run: false })
    ).rejects.toThrow(/git pull failed:/)
  })
})

// --- push ------------------------------------------------------------------

describe('pushRepo', () => {
  it('rejects detached HEAD without an explicit branch', async () => {
    const { repo } = await makeRepoWithUpstream('push-detached')
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n', 'utf-8')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'second')
    const { stdout } = await git(repo, 'rev-parse', 'HEAD~1')
    await git(repo, 'checkout', '-q', stdout.trim())
    await expect(
      pushRepo(SAFE_ROOTS, repo, { remote: 'origin', force_mode: 'none', set_upstream: false, tags: false, delete: false, dry_run: false })
    ).rejects.toThrow(/detached HEAD/)
  })

  it('default push with dry_run=true reports the executed argv and is non-destructive', async () => {
    const { repo, bare } = await makeRepoWithUpstream('push-dry')
    // Stage a local commit so dry-run has something to negotiate.
    await fs.writeFile(path.join(repo, 'pending.txt'), 'pending\n', 'utf-8')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'pending')

    const result = await pushRepo(SAFE_ROOTS, repo, {
      remote: 'origin',
      force_mode: 'none',
      set_upstream: false,
      tags: false,
      delete: false,
      dry_run: true
    })
    expect(result.dry_run).toBe(true)
    expect(result.command).toBe('git push --dry-run -- origin main')
    // Confirm bare upstream did NOT advance.
    const { stdout: bareSha } = await git(bare, 'rev-parse', 'main')
    const { stdout: localPriorSha } = await git(repo, 'rev-parse', 'HEAD~1')
    expect(bareSha.trim()).toBe(localPriorSha.trim())
  })

  it('builds --force-with-lease / --set-upstream / --tags into the argv', async () => {
    const { repo } = await makeRepoWithUpstream('push-flags')
    const result = await pushRepo(SAFE_ROOTS, repo, {
      remote: 'origin',
      force_mode: 'with_lease',
      set_upstream: true,
      tags: true,
      delete: false,
      dry_run: true
    })
    expect(result.command).toBe('git push --dry-run --force-with-lease --set-upstream --tags -- origin main')
    expect(result.force_mode).toBe('with_lease')
  })

  it("builds --force when force_mode='force' (no --force-with-lease)", async () => {
    const { repo } = await makeRepoWithUpstream('push-force')
    const result = await pushRepo(SAFE_ROOTS, repo, {
      remote: 'origin',
      force_mode: 'force',
      set_upstream: false,
      tags: false,
      delete: false,
      dry_run: true
    })
    expect(result.command).toBe('git push --dry-run --force -- origin main')
  })

  it('runs a real push when dry_run=false and updates the bare upstream', async () => {
    const { repo, bare } = await makeRepoWithUpstream('push-real')
    await fs.writeFile(path.join(repo, 'new.txt'), 'new\n', 'utf-8')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'new commit')

    const result = await pushRepo(SAFE_ROOTS, repo, {
      remote: 'origin',
      force_mode: 'none',
      set_upstream: false,
      tags: false,
      delete: false,
      dry_run: false
    })
    expect(result.command).toBe('git push -- origin main')
    const { stdout: localSha } = await git(repo, 'rev-parse', 'main')
    const { stdout: bareSha } = await git(bare, 'rev-parse', 'main')
    expect(localSha.trim()).toBe(bareSha.trim())
  })

  it('deletes a remote branch with --delete', async () => {
    const { repo, bare } = await makeRepoWithUpstream('push-delete')
    // Push a feature branch first so we have something to delete.
    await git(repo, 'checkout', '-q', '-b', 'feature')
    await fs.writeFile(path.join(repo, 'feat.txt'), 'f\n', 'utf-8')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'feat')
    await git(repo, 'push', '-q', 'origin', 'feature')

    const result = await pushRepo(SAFE_ROOTS, repo, {
      remote: 'origin',
      branch: 'feature',
      force_mode: 'none',
      set_upstream: false,
      tags: false,
      delete: true,
      dry_run: false
    })
    expect(result.command).toBe('git push --delete -- origin feature')
    // Branch should no longer exist on the bare upstream.
    await expect(git(bare, 'rev-parse', '--verify', 'refs/heads/feature')).rejects.toThrow()
  })

  it('wraps git failures with a "git push failed:" prefix', async () => {
    const { repo } = await makeRepoWithUpstream('push-fail')
    await expect(
      pushRepo(SAFE_ROOTS, repo, { remote: 'no-such', force_mode: 'none', set_upstream: false, tags: false, delete: false, dry_run: false })
    ).rejects.toThrow(/git push failed:/)
  })
})
