import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import { addRemote, listRemotes, removeRemote, setRemoteUrl } from '../../main/repo-remotes/index.js'
import { DESTRUCTIVE, READ_ONLY, WRITE, WRITE_IDEMPOTENT } from '../../utils/annotations.js'
import { remoteNameSchema, remoteUrlSchema } from '../../utils/git-exec.js'
import { errorResult, jsonResult } from '../../utils/results.js'

const absPathSchema = z
  .string()
  .min(1)
  .describe('Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit` result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.')

const listInput = z.object({ abs_path: absPathSchema }).strict()

const setUrlInput = z
  .object({
    abs_path: absPathSchema,
    remote: remoteNameSchema.describe('Existing remote name (e.g. "origin").'),
    url: remoteUrlSchema.describe('New URL for the remote. Validated against an option-injection regex; transport semantics are left to git.'),
    push: z.boolean().default(false).describe('When true, update only the push URL (`git remote set-url --push`). Default false (update fetch URL).'),
    dry_run: z.boolean().default(true).describe('When true (default), no git mutation is performed; the call returns the current remote entry as `before`.')
  })
  .strict()

const addInput = z
  .object({
    abs_path: absPathSchema,
    remote: remoteNameSchema.describe('New remote name (must not already exist).'),
    url: remoteUrlSchema.describe('URL for the new remote. Validated against an option-injection regex; transport semantics are left to git.'),
    dry_run: z.boolean().default(true).describe('When true (default), no git mutation is performed.')
  })
  .strict()

const removeInput = z
  .object({
    abs_path: absPathSchema,
    remote: remoteNameSchema.describe('Existing remote name to remove.'),
    dry_run: z.boolean().default(true).describe('When true (default), no git mutation is performed; the call returns the current remote entry as `before`.')
  })
  .strict()

export const registerRepoRemotesTools = (server: McpServer, cfg: Config): void => {
  server.registerTool(
    'git_repo_remotes_list',
    {
      title: 'List configured remotes for a repo',
      description: `Return the configured fetch/push URLs of every remote in the repo. Read-only — no network, no mutation.

\`abs_path\` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any \`git\` call; the cache cannot widen the security boundary.

Args:
  - abs_path (string): Absolute path to a git repo, must live inside one of MCP_GIT_AUDIT_SAFE_ROOTS.

Returns:
  JSON object: { abs_path, fetched_at, remotes: [{ name, fetch_url, push_url }] }. \`push_url\` equals \`fetch_url\` unless an override was set with \`set-url --push\`.`,
      inputSchema: listInput,
      annotations: READ_ONLY
    },
    async ({ abs_path }) => {
      try {
        return jsonResult(await listRemotes(cfg.safeRoots, abs_path))
      } catch (err) {
        return errorResult('listing remotes', err)
      }
    }
  )

  server.registerTool(
    'git_repo_remote_set_url',
    {
      title: "Change an existing remote's URL",
      description: `Update the fetch or push URL of an existing remote. Idempotent: running twice with the same args produces the same end state. The remote must already exist — use \`git_repo_remote_add\` to create new remotes.

Required access level: \`write\` or higher (MCP_GIT_AUDIT_ACCESS_LEVEL).

Args:
  - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
  - remote (string): Name of an existing remote (e.g. "origin"). Pattern [A-Za-z0-9_.-], not starting with "-" or ".".
  - url (string): New URL. Must not start with "-" (option-injection guard); whitespace and control chars are rejected.
  - push (boolean): When true, update only the push URL. Default false.
  - dry_run (boolean): When true (default), no mutation; the call returns the current remote entry as \`before\` for inspection.

Returns:
  JSON object: { abs_path, changed_at, dry_run, remote, before, after?, stderr }. \`after\` is omitted when \`dry_run=true\`.`,
      inputSchema: setUrlInput,
      annotations: WRITE_IDEMPOTENT
    },
    async ({ abs_path, remote, url, push, dry_run }) => {
      try {
        return jsonResult(await setRemoteUrl(cfg.safeRoots, abs_path, { remote, url, push, dry_run }))
      } catch (err) {
        return errorResult('setting remote url', err)
      }
    }
  )

  server.registerTool(
    'git_repo_remote_add',
    {
      title: 'Add a new remote',
      description: `Create a new remote with the given name and URL. Non-idempotent: a second call with the same remote name fails. Use \`git_repo_remote_set_url\` to change an existing remote's URL.

Required access level: \`write\` or higher (MCP_GIT_AUDIT_ACCESS_LEVEL).

Args:
  - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
  - remote (string): New remote name (must not already exist). Pattern [A-Za-z0-9_.-], not starting with "-" or ".".
  - url (string): URL for the new remote. Must not start with "-"; whitespace and control chars are rejected.
  - dry_run (boolean): When true (default), no mutation.

Returns:
  JSON object: { abs_path, changed_at, dry_run, remote, after?, stderr }. \`after\` is omitted when \`dry_run=true\`.`,
      inputSchema: addInput,
      annotations: WRITE
    },
    async ({ abs_path, remote, url, dry_run }) => {
      try {
        return jsonResult(await addRemote(cfg.safeRoots, abs_path, { remote, url, dry_run }))
      } catch (err) {
        return errorResult('adding remote', err)
      }
    }
  )

  server.registerTool(
    'git_repo_remote_remove',
    {
      title: 'Remove an existing remote',
      description: `Drop a remote's config and any \`refs/remotes/<name>/*\` tracking refs. Working-tree files are untouched. Idempotent end state: gone is gone.

Required access level: \`destructive\` (MCP_GIT_AUDIT_ACCESS_LEVEL).

Args:
  - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
  - remote (string): Name of the remote to remove.
  - dry_run (boolean): When true (default), no mutation; the call returns the current remote entry as \`before\` for inspection.

Returns:
  JSON object: { abs_path, changed_at, dry_run, remote, before, stderr }.`,
      inputSchema: removeInput,
      annotations: DESTRUCTIVE
    },
    async ({ abs_path, remote, dry_run }) => {
      try {
        return jsonResult(await removeRemote(cfg.safeRoots, abs_path, { remote, dry_run }))
      } catch (err) {
        return errorResult('removing remote', err)
      }
    }
  )
}
