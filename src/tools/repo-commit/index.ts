import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import { commitRepo, DIFF_MAX_LINES_CEILING, diffRepo } from '../../main/repo-commit/index.js'
import { DESTRUCTIVE_ONESHOT, READ_ONLY } from '../../utils/annotations.js'
import { errorResult, jsonResult } from '../../utils/results.js'

const absPathSchema = z
  .string()
  .min(1)
  .describe(
    'Absolute path to a git repo, taken from a prior `git_repos_scan`/`git_repos_audit` result. Revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any `git` call.'
  )

// Repo-relative path inputs. Same shape the core validates, surfaced in the
// schema so bad inputs are rejected before reaching `git`.
const relPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(
    /^(?!-)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\r\n]{1,4096}$/,
    'paths must be repo-relative, no leading "-" or "/", no ".." segments, no NUL/newline'
  )

const diffInput = z
  .object({
    abs_path: absPathSchema,
    staged: z
      .boolean()
      .default(false)
      .describe('`false` (default) → `git diff` (unstaged). `true` → `git diff --cached` (staged).'),
    paths: z
      .array(relPathSchema)
      .max(1024)
      .optional()
      .describe('Limit the diff to these repo-relative paths. When omitted, returns every changed file.'),
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
    message: commitMessageSchema.describe(
      'Commit message. Single-line in v1 (no multi-line messages - no `\\n` support).'
    ),
    stage: z
      .enum(['paths', 'prepared_index'])
      .default('paths')
      .describe(
        'How the commit is built. `paths` (default): from HEAD plus the working-tree content of exactly the named paths; nothing else already staged is included. `prepared_index`: the current index as-is, only when its staged path set equals `paths` exactly. The broad modes `all_tracked`, `all` and `none` were removed and fail validation.'
      ),
    paths: z
      .array(relPathSchema)
      .min(1)
      .max(1024)
      .describe(
        'Required, non-empty. Literal repo-relative file paths: no directories, no pathspec magic (`:`, `*`, `?`, `[`), no `..` segments, no leading `-` or `/`. Each must be present in the working tree or tracked at HEAD (a tracked deletion).'
      ),
    dry_run: z
      .boolean()
      .default(true)
      .describe(
        'When true (default), runs `git commit --dry-run` against a temporary index - shows what would be committed without writing an object, moving HEAD or changing the real index.'
      ),
    allow_empty: z
      .boolean()
      .default(false)
      .describe('Pass `--allow-empty`. Default false - empty commits are almost always a mistake.')
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
  ok: z.boolean(),
  error: z.string().nullable(),
  abs_path: z.string(),
  ran_at: z.string(),
  dry_run: z.boolean(),
  stage: z.enum(['paths', 'prepared_index']),
  staged_paths: z.array(z.string()),
  skipped_paths: z.array(z.string()),
  rejected_paths: z.array(z.object({ path: z.string(), reason: z.string() })),
  hook_modified_paths: z.array(z.string()),
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
      title: 'Commit exactly the named paths',
      description: `Commit exactly the named files. Destructive - writes a commit object and moves HEAD when \`dry_run=false\`. Safe in a working tree shared with other people or agents: nothing outside \`paths\` is staged or committed, and unrelated staged entries in the real index survive.

The commit is built in a temporary index (\`GIT_INDEX_FILE\`) under the repository's Git directory, removed after every call. \`stage="paths"\` (default) seeds it from HEAD and adds only the named paths; \`stage="prepared_index"\` copies the real index, but only when its staged path set equals \`paths\` exactly - otherwise the call refuses and lists the extra and missing paths in \`rejected_paths\`. The broad modes \`all_tracked\`, \`all\` and \`none\` no longer exist and fail validation.

\`dry_run=true\` (the default) runs \`git commit --dry-run\` against the temporary index: the real index, HEAD and the object store are unchanged. A preview grants no later authority; every call revalidates. After a real commit, the real index entries for exactly the committed paths take their committed content (as \`git commit --only\` does).

Every path is validated before any Git write: literal, repo-relative file paths only - no directories, no pathspec magic (\`:\`, \`*\`, \`?\`, \`[\`), no \`..\`, no leading \`-\` or \`/\` - and each present in the working tree or tracked at HEAD. All failures are listed in \`rejected_paths\` and nothing is done. \`abs_path\` is revalidated against MCP_GIT_AUDIT_SAFE_ROOTS before any \`git\` call.

Calls are serialised per repository; a call refuses if HEAD moves during preparation or a merge, cherry-pick or revert is in progress. Hooks run. If the resulting commit's path set differs from the approved one (for example a pre-commit hook staged another file), the result is \`ok: false\` with the SHA and \`hook_modified_paths\`; the commit is never reset, amended or rewritten. No \`--amend\`.

Required access level: \`destructive\` (MCP_GIT_AUDIT_ACCESS_LEVEL).

Args:
  - abs_path (string): Absolute path to a git repo, must live inside MCP_GIT_AUDIT_SAFE_ROOTS.
  - message (string): Commit message. Single-line in v1.
  - stage ("paths" | "prepared_index"): How the commit is built. Default "paths".
  - paths (string[]): Required, non-empty. Literal repo-relative file paths.
  - dry_run (boolean): Preview only. Default true.
  - allow_empty (boolean): Pass \`--allow-empty\`. Default false.

Returns:
  JSON object: { ok, error, abs_path, ran_at, dry_run, stage, staged_paths, skipped_paths, rejected_paths: [{ path, reason }], hook_modified_paths, message, command, sha, stdout, stderr }. \`ok\` is false, with \`error\` set, for any refusal or failure. \`staged_paths\` is what the commit (would) contain; \`skipped_paths\` are named paths unchanged from HEAD. \`sha\` is the short SHA of the new commit, or \`null\` on dry run or when no commit was made.`,
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
