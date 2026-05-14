import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { auditScan } from '../../audit.js'
import { SAFE_ROOTS } from '../../config.js'
import { type ScanResult, scanRoot } from '../../scan.js'
import { READ_ONLY } from '../../utils/annotations.js'
import { errMessage, errorResult, jsonResult, resolveAgainstSafeRoots } from '../../utils.js'

const resolveRootArg = async (root: string | undefined): Promise<string | { error: string }> => {
  if (root === undefined) {
    if (SAFE_ROOTS.length !== 1) {
      return { error: `root is required when multiple safe_roots are configured (${SAFE_ROOTS.join(', ')})` }
    }
    return SAFE_ROOTS[0]
  }
  try {
    return await resolveAgainstSafeRoots(root, SAFE_ROOTS)
  } catch (err) {
    return { error: errMessage(err) }
  }
}

const scanInput = z
  .object({
    root: z.string().min(1).optional().describe('Absolute or ~-expanded path to walk. Must be inside one of MCP_GIT_AUDIT_SAFE_ROOTS. Omit when exactly one safe root is configured.'),
    max_depth: z.number().int().min(1).max(8).default(2).describe('Maximum depth (from `root`) at which a repo directory may live. Default 2.')
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
      .describe('A previous scan result. Every repo `abs_path` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call is made.'),
    include_stale_days: z.number().int().min(1).default(30).describe('Reserved — currently unused; the consumer computes stale itself.')
  })
  .strict()

export const registerRepoAuditTools = (server: McpServer): void => {
  server.registerTool(
    'scan',
    {
      title: 'Scan a tree for git repositories',
      description: `Walk a directory tree for .git directories and return repo metadata. Cheap and side-effect-free — no \`git\` invocations. The output is intended to be cached and fed into \`audit\` one or more times.

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
      annotations: READ_ONLY
    },
    async ({ root, max_depth }) => {
      try {
        const resolved = await resolveRootArg(root)
        if (typeof resolved !== 'string') return errorResult(resolved.error)
        return jsonResult(await scanRoot(resolved, { max_depth }))
      } catch (err) {
        return errorResult(`Error scanning: ${errMessage(err)}`)
      }
    }
  )

  server.registerTool(
    'audit',
    {
      title: 'Audit git repositories from a prior scan',
      description: `Run per-repo \`git\` checks (branch, working-tree status, ahead/behind, last commit) over a scan result. Designed to be called repeatedly against the same cached scan output — the cheap filesystem walk happens once, the more expensive git work can be re-run on demand.

Every \`abs_path\` in the supplied scan is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any \`git\` call. A path that escapes every safe root is rejected — the cache cannot be used to widen the security boundary.

Args:
  - scan (object): a prior result from the \`scan\` tool: { root, scanned_at, repos: [{ path, abs_path, group, name }] }.
  - include_stale_days (number): Reserved; currently unused. Default 30.

Returns:
  JSON object: { root, scanned_at, audited_at, repos: [...], errors?: [...] } where each repo entry includes path, group, name, branch, detached, sha, subject, rel_date, iso_date, modified, untracked, has_remote, has_upstream, ahead, behind.

Per-repo failures (e.g. corrupt .git/HEAD) are aggregated into the \`errors\` array rather than failing the whole call.`,
      inputSchema: auditInput,
      annotations: READ_ONLY
    },
    async ({ scan, include_stale_days }) => {
      try {
        const rootResolved = await resolveRootArg(scan.root)
        if (typeof rootResolved !== 'string') return errorResult(rootResolved.error)

        const validatedRepos = []
        for (const r of scan.repos) {
          try {
            const absResolved = await resolveAgainstSafeRoots(r.abs_path, SAFE_ROOTS)
            validatedRepos.push({ ...r, abs_path: absResolved })
          } catch (err) {
            return errorResult(`scan.repos[${r.path}].abs_path: ${errMessage(err)}`)
          }
        }
        const validatedScan: ScanResult = { ...scan, root: rootResolved, repos: validatedRepos }
        return jsonResult(await auditScan(validatedScan, { include_stale_days }))
      } catch (err) {
        return errorResult(`Error auditing: ${errMessage(err)}`)
      }
    }
  )
}
