import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import { fetchRepo, pullRepo, pushRepo } from '../../main/repo-sync/index.js'
import { DESTRUCTIVE_REMOTE, WRITE_IDEMPOTENT_REMOTE } from '../../utils/annotations.js'
import { branchNameSchema, remoteNameSchema } from '../../utils/git-exec.js'
import { errorResult, jsonResult } from '../../utils/results.js'

const absPathSchema = z
  .string()
  .min(1)
  .describe(
    'Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit` result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.'
  )

const fetchInput = z
  .object({
    abs_path: absPathSchema,
    remote: remoteNameSchema.default('origin').describe('Remote to fetch from. Ignored when `all_remotes=true`.'),
    prune: z.boolean().default(false).describe('Pass `--prune` to drop remote-tracking refs whose upstream branches have been deleted.'),
    tags: z.boolean().default(false).describe('Pass `--tags` to fetch all tags, not just those reachable from fetched commits.'),
    all_remotes: z.boolean().default(false).describe('Pass `--all` to fetch every configured remote. Overrides `remote`.'),
    dry_run: z.boolean().default(false).describe('Pass `--dry-run` to git itself — connects to the remote but does not update local refs.')
  })
  .strict()

const pullInput = z
  .object({
    abs_path: absPathSchema,
    remote: remoteNameSchema.default('origin').describe('Remote to pull from.'),
    branch: branchNameSchema.optional().describe("Branch to pull. Defaults to the repo's current branch. Required when HEAD is detached."),
    rebase: z
      .boolean()
      .default(false)
      .describe('Pass `--rebase` to rebase local commits onto the upstream instead of merging. Rewrites history — opt in explicitly.'),
    ff_only: z
      .boolean()
      .default(true)
      .describe(
        'Pass `--ff-only` (default true). Aborts with a clear error when the upstream has diverged, instead of producing a merge commit.'
      ),
    autostash: z
      .boolean()
      .default(false)
      .describe('Pass `--autostash` to stash uncommitted changes for the duration of the pull and re-apply afterwards.'),
    dry_run: z
      .boolean()
      .default(true)
      .describe(
        'When true (default), the call runs `git fetch --dry-run` against the same remote/branch instead of pulling — git pull has no native dry-run.'
      )
  })
  .strict()

const pushInput = z
  .object({
    abs_path: absPathSchema,
    remote: remoteNameSchema.default('origin').describe('Remote to push to.'),
    branch: branchNameSchema.optional().describe("Branch to push. Defaults to the repo's current branch. Required when HEAD is detached."),
    force_mode: z
      .enum(['none', 'with_lease', 'force'])
      .default('none')
      .describe(
        '`none` (default): no force flag. `with_lease`: `--force-with-lease` (safer). `force`: `--force` (overwrites remote unconditionally — destructive).'
      ),
    set_upstream: z
      .boolean()
      .default(false)
      .describe('Pass `--set-upstream` to record the remote/branch as the upstream for future pulls.'),
    tags: z.boolean().default(false).describe('Pass `--tags` to push all tags reachable from the pushed refs.'),
    delete: z.boolean().default(false).describe('Pass `--delete` to delete the branch on the remote. Destructive.'),
    dry_run: z.boolean().default(true).describe('Pass `--dry-run` to git itself — negotiates with the remote but does not update any refs.')
  })
  .strict()

const fetchOutput = z.object({
  abs_path: z.string(),
  ran_at: z.string(),
  dry_run: z.boolean(),
  remote: z.string(),
  prune: z.boolean(),
  tags: z.boolean(),
  all_remotes: z.boolean(),
  command: z.string(),
  stdout: z.string(),
  stderr: z.string()
})

const pullOutput = z.object({
  abs_path: z.string(),
  ran_at: z.string(),
  dry_run: z.boolean(),
  remote: z.string(),
  branch: z.string().optional(),
  rebase: z.boolean(),
  ff_only: z.boolean(),
  autostash: z.boolean(),
  command: z.string(),
  stdout: z.string(),
  stderr: z.string()
})

const pushOutput = z.object({
  abs_path: z.string(),
  ran_at: z.string(),
  dry_run: z.boolean(),
  remote: z.string(),
  branch: z.string().optional(),
  force_mode: z.string(),
  set_upstream: z.boolean(),
  tags: z.boolean(),
  delete: z.boolean(),
  command: z.string(),
  stdout: z.string(),
  stderr: z.string()
})

export const registerRepoSyncTools = (server: McpServer, cfg: Config): void => {
  server.registerTool(
    'git_repo_fetch',
    {
      title: 'Fetch from a remote (no merge)',
      description: `Run \`git fetch\`. Updates remote-tracking refs and FETCH_HEAD but does NOT modify the working tree or local branches. Network I/O — bounded by a 60s timeout, with interactive credential prompts disabled (\`GIT_TERMINAL_PROMPT=0\`) so an auth-required remote fails fast instead of stalling.

Required access level: \`write\` or higher (MCP_GIT_AUDIT_ACCESS_LEVEL).

Args:
  - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
  - remote (string): Remote to fetch (default "origin"). Ignored when \`all_remotes=true\`.
  - prune (boolean): Pass \`--prune\`. Default false.
  - tags (boolean): Pass \`--tags\`. Default false.
  - all_remotes (boolean): Pass \`--all\` (overrides \`remote\`). Default false.
  - dry_run (boolean): Pass \`--dry-run\` (default false).

Returns:
  JSON object: { abs_path, ran_at, dry_run, remote, prune, tags, all_remotes, command, stdout, stderr }. Most useful output (refs updated) is on \`stderr\` — that's where git writes it.`,
      inputSchema: fetchInput,
      outputSchema: fetchOutput,
      annotations: WRITE_IDEMPOTENT_REMOTE
    },
    async ({ abs_path, remote, prune, tags, all_remotes, dry_run }) => {
      try {
        return jsonResult(await fetchRepo(cfg.safeRoots, abs_path, { remote, prune, tags, all_remotes, dry_run }))
      } catch (err) {
        return errorResult('fetching', err)
      }
    }
  )

  server.registerTool(
    'git_repo_pull',
    {
      title: 'Pull from a remote (merge or rebase)',
      description: `Run \`git pull\`. Destructive — updates the working tree and the current branch. Defaults to the safest shape: \`ff_only=true\` (abort on divergence) and \`rebase=false\` (no history rewrite). Pass \`rebase=true\` explicitly to rewrite local commits. \`ff_only\` and \`rebase\` are mutually exclusive.

\`dry_run=true\` (the default) approximates a preview by running \`git fetch --dry-run\` against the same remote/branch — git pull itself has no native dry-run.

Required access level: \`destructive\` (MCP_GIT_AUDIT_ACCESS_LEVEL).

Args:
  - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
  - remote (string): Remote to pull from (default "origin").
  - branch (string): Branch to pull. Defaults to the repo's current branch; required when HEAD is detached.
  - rebase (boolean): Pass \`--rebase\`. Default false. Mutually exclusive with \`ff_only\`.
  - ff_only (boolean): Pass \`--ff-only\`. Default true.
  - autostash (boolean): Pass \`--autostash\`. Default false.
  - dry_run (boolean): When true (default), runs \`git fetch --dry-run\` instead of pulling.

Returns:
  JSON object: { abs_path, ran_at, dry_run, remote, branch, rebase, ff_only, autostash, command, stdout, stderr }.`,
      inputSchema: pullInput,
      outputSchema: pullOutput,
      annotations: DESTRUCTIVE_REMOTE
    },
    async ({ abs_path, remote, branch, rebase, ff_only, autostash, dry_run }) => {
      try {
        return jsonResult(await pullRepo(cfg.safeRoots, abs_path, { remote, branch, rebase, ff_only, autostash, dry_run }))
      } catch (err) {
        return errorResult('pulling', err)
      }
    }
  )

  server.registerTool(
    'git_repo_push',
    {
      title: 'Push to a remote',
      description: `Run \`git push\`. Destructive — updates remote refs. Defaults to the safest shape: \`force_mode='none'\`, no \`--set-upstream\`, no \`--tags\`, no \`--delete\`, and \`dry_run=true\`. \`--force\` is gated behind an explicit enum (\`force_mode: 'none' | 'with_lease' | 'force'\`) so the caller can't accidentally non-FF-push by toggling a boolean.

Required access level: \`destructive\` (MCP_GIT_AUDIT_ACCESS_LEVEL).

Args:
  - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
  - remote (string): Remote to push to (default "origin").
  - branch (string): Branch to push. Defaults to the repo's current branch; required when HEAD is detached.
  - force_mode ("none" | "with_lease" | "force"): How aggressively to overwrite the remote. Default "none".
  - set_upstream (boolean): Pass \`--set-upstream\`. Default false.
  - tags (boolean): Pass \`--tags\`. Default false.
  - delete (boolean): Pass \`--delete\` to delete the branch on the remote. Default false.
  - dry_run (boolean): Pass \`--dry-run\` to git itself. Default true.

Returns:
  JSON object: { abs_path, ran_at, dry_run, remote, branch, force_mode, set_upstream, tags, delete, command, stdout, stderr }.`,
      inputSchema: pushInput,
      outputSchema: pushOutput,
      annotations: DESTRUCTIVE_REMOTE
    },
    async ({ abs_path, remote, branch, force_mode, set_upstream, tags, delete: deleteFlag, dry_run }) => {
      try {
        return jsonResult(
          await pushRepo(cfg.safeRoots, abs_path, { remote, branch, force_mode, set_upstream, tags, delete: deleteFlag, dry_run })
        )
      } catch (err) {
        return errorResult('pushing', err)
      }
    }
  )
}
