import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import { commitRepo, DIFF_MAX_LINES_CEILING, diffRepo } from '../../main/repo-commit/index.js'
import { DESTRUCTIVE_ONESHOT, READ_ONLY } from '../../utils/annotations.js'
import { errorResult, jsonResult } from '../../utils/results.js'

const absPathSchema = z
  .string()
  .min(1)
  .describe('Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit` result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.')

// Repo-relative path inputs. Same shape the core validates, surfaced in the
// schema so bad inputs are rejected before reaching `git`.
const relPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^(?!-)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\r\n]{1,4096}$/, 'paths must be repo-relative, no leading "-" or "/", no ".." segments, no NUL/newline')

const diffInput = z
  .object({
    abs_path: absPathSchema,
    staged: z.boolean().default(false).describe('`false` (default) → `git diff` (unstaged). `true` → `git diff --cached` (staged).'),
    paths: z.array(relPathSchema).max(1024).optional().describe('Limit the diff to these repo-relative paths. When omitted, returns every changed file.'),
    max_lines: z
      .number()
      .int()
      .min(1)
      .max(DIFF_MAX_LINES_CEILING)
      .default(500)
      .describe(
        `Cap on total diff body lines across all files. When a file's diff would exceed the remaining budget, its \`diff\` is set to null and the file's \`truncated\` flag is true. Max ${DIFF_MAX_LINES_CEILING}.`
      )
  })
  .strict()

const commitMessageSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[^\r\n]+$/, 'commit message must be a single line (no newline characters)')

const commitInput = z
  .object({
    abs_path: absPathSchema,
    message: commitMessageSchema.describe('Commit message. Single-line in v1 (no multi-line messages — no `\\n` support).'),
    stage: z
      .enum(['all_tracked', 'all', 'paths', 'none'])
      .default('all_tracked')
      .describe('What to stage before committing. `all_tracked` → `git add -u`. `all` → `git add -A`. `paths` → `git add -- <paths>` (requires `paths`). `none` → commit the index as-is.'),
    paths: z.array(relPathSchema).max(1024).optional().describe('Required when `stage === "paths"`, rejected otherwise. Repo-relative file paths.'),
    dry_run: z
      .boolean()
      .default(true)
      .describe(
        'When true (default), runs `git commit --dry-run` — shows what would be committed without writing an object or moving HEAD. The staging step still runs because the index is local, fully reversible state and the preview needs to reflect it.'
      ),
    allow_empty: z.boolean().default(false).describe('Pass `--allow-empty`. Default false — empty commits are almost always a mistake.')
  })
  .strict()

const diffFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  diff: z.string().nullable(),
  truncated: z.boolean()
})

const diffOutput = z.object({
  abs_path: z.string(),
  staged: z.boolean(),
  fetched_at: z.string(),
  total_additions: z.number(),
  total_deletions: z.number(),
  truncated: z.boolean(),
  files: z.array(diffFileSchema)
})

const commitOutput = z.object({
  abs_path: z.string(),
  ran_at: z.string(),
  dry_run: z.boolean(),
  stage: z.string(),
  staged_paths: z.array(z.string()),
  message: z.string(),
  command: z.string(),
  sha: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string()
})

export const registerRepoCommitTools = (server: McpServer, cfg: Config): void => {
  server.registerTool(
    'git_repo_diff',
    {
      title: 'Show structured diff for unstaged or staged changes',
      description: `Return structured diff data for the working tree or the index. Read-only — no network, no mutation. Internally runs three \`git diff\` invocations (\`--numstat -z\`, \`--name-status -z\`, and unified patch) so each file entry can carry counts, a status letter, and the patch body without re-implementing rename-aware path parsing on top of an interleaved \`-p --numstat\` stream.

\`abs_path\` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any \`git\` call; a cached scan cannot widen the security boundary. Any \`paths\` entry must be repo-relative — leading \`-\` / \`/\` and \`..\` segments are rejected.

\`max_lines\` is a budget across all files. Once a file's diff would push the running total over the cap, that file's \`diff\` becomes \`null\` and its \`truncated\` flag is set; subsequent files are likewise null+truncated. The top-level \`truncated\` is the disjunction over file entries.

Args:
  - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
  - staged (boolean): \`false\` (default) for unstaged diff, \`true\` for \`--cached\`.
  - paths (string[]): Optional repo-relative pathspec to narrow the diff.
  - max_lines (integer): Total diff body line cap. Default 500, max ${DIFF_MAX_LINES_CEILING}.

Returns:
  JSON object: { abs_path, staged, fetched_at, total_additions, total_deletions, truncated, files: [{ path, status, additions, deletions, diff, truncated }] }.`,
      inputSchema: diffInput,
      outputSchema: diffOutput,
      annotations: READ_ONLY
    },
    async ({ abs_path, staged, paths, max_lines }) => {
      try {
        return jsonResult(await diffRepo(cfg.safeRoots, abs_path, { staged, paths, max_lines }))
      } catch (err) {
        return errorResult('reading diff', err)
      }
    }
  )

  server.registerTool(
    'git_repo_commit',
    {
      title: 'Stage files and create a commit',
      description: `Stage a set of files and create a commit. Destructive — writes a commit object and moves HEAD when \`dry_run=false\`. Handles the full add → commit lifecycle in one call so the artifact's "preview → confirm" loop reduces to two MCP calls.

\`dry_run=true\` (the default) runs the staging step normally but invokes \`git commit --dry-run\` — git prints what would be committed without writing an object or moving HEAD. The index mutation done by the staging step is local-only state and is fully reversible with \`git reset\`; treating it as part of the preview is intentional, because the artifact preview needs to reflect the post-stage state.

\`abs_path\` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any \`git\` call. \`paths\` entries (only allowed when \`stage="paths"\`) must be repo-relative — leading \`-\` / \`/\` and \`..\` segments are rejected as an option-injection guard.

No \`--amend\` in v1. Amending rewrites history and complicates the push flow (would need force-with-lease). Adding it later requires an explicit \`amend: true\` flag with its own warning copy.

Required access level: \`destructive\` (MCP_GIT_AUDIT_ACCESS_LEVEL).

Args:
  - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
  - message (string): Commit message. Single-line in v1.
  - stage ("all_tracked" | "all" | "paths" | "none"): What to stage before committing. Default "all_tracked".
  - paths (string[]): Required when \`stage="paths"\`, rejected otherwise. Repo-relative paths.
  - dry_run (boolean): Pass \`--dry-run\` to git commit. Default true.
  - allow_empty (boolean): Pass \`--allow-empty\`. Default false.

Returns:
  JSON object: { abs_path, ran_at, dry_run, stage, staged_paths, message, command, sha, stdout, stderr }. \`sha\` is the short SHA of the new HEAD, or \`null\` on dry-run.`,
      inputSchema: commitInput,
      outputSchema: commitOutput,
      annotations: DESTRUCTIVE_ONESHOT
    },
    async ({ abs_path, message, stage, paths, dry_run, allow_empty }) => {
      try {
        return jsonResult(await commitRepo(cfg.safeRoots, abs_path, { message, stage, paths, dry_run, allow_empty }))
      } catch (err) {
        return errorResult('committing', err)
      }
    }
  )
}
