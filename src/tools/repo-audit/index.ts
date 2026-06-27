import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import { auditScan, repoDetail, type ScanResult, scanRoot } from '../../main/repo-audit/index.js'
import { READ_ONLY } from '../../utils/annotations.js'
import { errMessage } from '../../utils/errors.js'
import { resolveAgainstSafeRoots } from '../../utils/paths.js'
import { errorResult, jsonResult } from '../../utils/results.js'

const resolveRootArg = async (safeRoots: readonly string[], root: string | undefined): Promise<string | { error: string }> => {
  if (root === undefined) {
    const [sole] = safeRoots
    if (safeRoots.length !== 1 || sole === undefined) {
      return { error: `root is required when multiple safe_roots are configured (${safeRoots.join(', ')})` }
    }
    return sole
  }
  try {
    return await resolveAgainstSafeRoots(root, safeRoots)
  } catch (err) {
    return { error: errMessage(err) }
  }
}

const scanInput = z
  .object({
    root: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Absolute or ~-expanded path to walk. Must be inside one of MCP_GIT_AUDIT_SAFE_ROOTS. Omit when exactly one safe root is configured.'
      ),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(8)
      .default(2)
      .describe('Maximum depth (from `root`) at which a repo directory may live. Default 2.')
  })
  .strict()

const scannedRepoSchema = z
  .object({
    path: z.string(),
    abs_path: z.string(),
    group: z.string(),
    name: z.string()
  })
  .strict()

const auditInput = z
  .object({
    scan: z
      .object({
        root: z.string(),
        scanned_at: z.string(),
        repos: z.array(scannedRepoSchema)
      })
      .strict()
      .describe(
        'A previous scan result. Every repo `abs_path` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call is made.'
      ),
    include_stale_days: z.number().int().min(1).default(30).describe('Reserved — currently unused; the consumer computes stale itself.')
  })
  .strict()

const detailInput = z
  .object({
    abs_path: z
      .string()
      .min(1)
      .describe(
        'Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit` result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.'
      ),
    commits: z.number().int().min(1).max(50).default(10).describe('How many recent commits to return (newest first). Hard cap 50.'),
    include_diffstat: z
      .boolean()
      .default(false)
      .describe(
        'When true, include per-commit `diffstat[]` (added/removed/path) from `git log --numstat`. Slightly slower; `files` count is always returned.'
      )
  })
  .strict()

const auditedRepoSchema = z.object({
  path: z.string(),
  abs_path: z.string(),
  group: z.string(),
  name: z.string(),
  branch: z.string(),
  detached: z.boolean(),
  sha: z.string(),
  subject: z.string(),
  rel_date: z.string(),
  iso_date: z.string(),
  modified: z.number(),
  untracked: z.number(),
  has_remote: z.boolean(),
  has_upstream: z.boolean(),
  ahead: z.number(),
  behind: z.number()
})

const diffstatEntrySchema = z.object({ added: z.number(), removed: z.number(), path: z.string() })

const commitEntrySchema = z.object({
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  iso_date: z.string(),
  rel_date: z.string(),
  files: z.number(),
  diffstat: z.array(diffstatEntrySchema).optional()
})

const workingTreeSchema = z.object({
  modified: z.array(z.object({ status: z.string(), path: z.string() })),
  summary: z.object({ modified: z.number(), untracked: z.number() })
})

const scanOutput = z.object({ root: z.string(), scanned_at: z.string(), repos: z.array(scannedRepoSchema) })

const auditOutput = z.object({
  root: z.string(),
  scanned_at: z.string(),
  audited_at: z.string(),
  repos: z.array(auditedRepoSchema),
  errors: z.array(z.string()).optional()
})

const detailOutput = z.object({
  abs_path: z.string(),
  path: z.string(),
  fetched_at: z.string(),
  commits: z.array(commitEntrySchema),
  working_tree: workingTreeSchema,
  error: z.string().optional()
})

export const registerRepoAuditTools = (server: McpServer, cfg: Config): void => {
  server.registerTool(
    'git_repos_scan',
    {
      title: 'Scan a tree for git repositories',
      description: `Walk a directory tree for .git directories and return repo metadata. Cheap and side-effect-free — no \`git\` invocations. The output is intended to be cached and fed into \`git_repos_audit\` one or more times.

Args:
  - root (string, optional): Absolute or ~/... path inside one of MCP_GIT_AUDIT_SAFE_ROOTS. Omit to use the single configured safe root.
  - max_depth (number): Max depth from \`root\` at which a repo dir may live. Default 2.

Returns:
  JSON object: { root, scanned_at, repos: [{ path, abs_path, group, name }] }.

Errors:
  - "root \\"X\\" is not inside any configured safe_root (...)" when the root escapes safe_roots.
  - "root must be an absolute path or start with ~/" for relative roots.
  - "root is required when multiple safe_roots are configured" when omitted with multiple safe_roots.`,
      inputSchema: scanInput,
      outputSchema: scanOutput,
      annotations: READ_ONLY
    },
    async ({ root, max_depth }) => {
      try {
        const resolved = await resolveRootArg(cfg.safeRoots, root)
        if (typeof resolved !== 'string') return errorResult('scanning repos', new Error(resolved.error))
        return jsonResult(await scanRoot(resolved, { max_depth }))
      } catch (err) {
        return errorResult('scanning repos', err)
      }
    }
  )

  server.registerTool(
    'git_repos_audit',
    {
      title: 'Audit git repositories from a prior scan',
      description: `Run per-repo \`git\` checks (branch, working-tree status, ahead/behind, last commit) over a scan result. Designed to be called repeatedly against the same cached scan output — the cheap filesystem walk happens once, the more expensive git work can be re-run on demand.

Every \`abs_path\` in the supplied scan is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any \`git\` call. A path that escapes every safe root is rejected — the cache cannot be used to widen the security boundary.

Args:
  - scan (object): a prior result from the \`git_repos_scan\` tool: { root, scanned_at, repos: [{ path, abs_path, group, name }] }.
  - include_stale_days (number): Reserved; currently unused. Default 30.

Returns:
  JSON object: { root, scanned_at, audited_at, repos: [...], errors?: [...] } where each repo entry includes path, group, name, branch, detached, sha, subject, rel_date, iso_date, modified, untracked, has_remote, has_upstream, ahead, behind.

Per-repo failures (e.g. corrupt .git/HEAD) are aggregated into the \`errors\` array rather than failing the whole call.`,
      inputSchema: auditInput,
      outputSchema: auditOutput,
      annotations: READ_ONLY
    },
    async ({ scan, include_stale_days }) => {
      try {
        const rootResolved = await resolveRootArg(cfg.safeRoots, scan.root)
        if (typeof rootResolved !== 'string') return errorResult('auditing repos', new Error(rootResolved.error))

        const validatedRepos = []
        for (const r of scan.repos) {
          try {
            const absResolved = await resolveAgainstSafeRoots(r.abs_path, cfg.safeRoots)
            validatedRepos.push({ ...r, abs_path: absResolved })
          } catch (err) {
            return errorResult('auditing repos', new Error(`scan.repos[${r.path}].abs_path: ${errMessage(err)}`))
          }
        }
        const validatedScan: ScanResult = { ...scan, root: rootResolved, repos: validatedRepos }
        return jsonResult(await auditScan(validatedScan, { include_stale_days }))
      } catch (err) {
        return errorResult('auditing repos', err)
      }
    }
  )

  server.registerTool(
    'git_repo_detail',
    {
      title: 'Per-repo commit history and changed-file listing',
      description: `Return commit history and working-tree status for a single repo identified by an absolute path from a prior \`git_repos_scan\`/\`git_repos_audit\` result. Read-only and cheap — no fetch, no diff content, no cross-repo work.

\`abs_path\` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any \`git\` call; the cache cannot widen the security boundary.

Args:
  - abs_path (string): Absolute path to a git repo, must live inside one of MCP_GIT_AUDIT_SAFE_ROOTS.
  - commits (number): Recent commits to return (newest first). Default 10, max 50.
  - include_diffstat (boolean): When true, include per-commit \`diffstat[]\` from \`git log --numstat\`. Default false. \`files\` count is always returned.

Returns:
  JSON object: { abs_path, path, fetched_at, commits: [{ sha, subject, author, iso_date, rel_date, files, diffstat? }], working_tree: { modified: [{ status, path }], summary: { modified, untracked } }, error? } where each \`modified[]\` entry's \`status\` is the raw two-character \`git status --porcelain\` code.

Status codes mirror \`git status --porcelain\` verbatim so downstream consumers other than the Cowork artifact can interpret them precisely. Errors (timeout, unborn HEAD on a fresh repo with no commits) surface as a \`commits: []\` result with an \`error\` field rather than throwing.`,
      inputSchema: detailInput,
      outputSchema: detailOutput,
      annotations: READ_ONLY
    },
    async ({ abs_path, commits, include_diffstat }) => {
      try {
        return jsonResult(await repoDetail(cfg.safeRoots, abs_path, { commits, include_diffstat }))
      } catch (err) {
        return errorResult('reading repo detail', err)
      }
    }
  )
}
