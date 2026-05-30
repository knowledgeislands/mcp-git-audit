#!/usr/bin/env node
// End-to-end smoke test: boot the built server over stdio MCP, list its tools,
// and assert the surface matches what the registration tests expect. Catches
// drift between code and the *wire* contract (registration tests cover the
// in-process registration call pattern; this covers the actual protocol round-trip).
//
// Run via `bun run test:smoke` (builds dist/ first). Runs in CI without secrets:
// the access level is raised to `destructive` so every tool is visible, and
// MCP_GIT_AUDIT_SAFE_ROOTS is pinned to the OS temp dir so config validation
// passes regardless of the host environment.

import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Single source of truth for the tool surface — kept in sync with the
// registration call sites in src/tools/*/index.ts. If you add a tool, update both.
const EXPECTED_TOOLS = [
  // repo-audit (read-only)
  'git_repos_scan',
  'git_repos_audit',
  'git_repo_detail',
  // repo-commit
  'git_repo_diff',
  'git_repo_commit',
  // repo-remotes
  'git_repo_remotes_list',
  'git_repo_remote_set_url',
  'git_repo_remote_add',
  'git_repo_remote_remove',
  // repo-sync
  'git_repo_fetch',
  'git_repo_pull',
  'git_repo_push'
] as const

const die = (msg: string, detail?: unknown): never => {
  console.error(`✗ smoke failed: ${msg}`)
  if (detail !== undefined) console.error(detail)
  process.exit(1)
}

const main = async (): Promise<void> => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/mcp-server/index.js'],
    env: {
      ...(process.env as Record<string, string>),
      // Raise the access level to `destructive` so the smoke test sees the full
      // surface; the server's default (read only) would otherwise hide every
      // mutating git_* tool.
      MCP_GIT_AUDIT_ACCESS_LEVEL: 'destructive',
      // Pin the safe root to a directory that exists on any host so config
      // validation passes without leaning on the host's home dir.
      MCP_GIT_AUDIT_SAFE_ROOTS: tmpdir()
    }
  })
  const client = new Client({ name: 'mcp-git-audit-smoke', version: '0.0.0' }, { capabilities: {} })

  await client.connect(transport)

  try {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    const expected = [...EXPECTED_TOOLS].sort()

    // Diff with clear messages so CI logs are actionable.
    const missing = expected.filter((n) => !names.includes(n))
    const extra = names.filter((n) => !expected.includes(n as (typeof EXPECTED_TOOLS)[number]))
    if (missing.length || extra.length) {
      die('tool surface mismatch', { missing, extra, actualCount: names.length, expectedCount: expected.length })
    }

    // Sanity: every tool advertises an inputSchema object.
    const missingSchema = tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== 'object').map((t) => t.name)
    if (missingSchema.length) die('tools missing inputSchema', missingSchema)

    console.error(`✓ smoke passed: ${names.length} tools listed, all schemas present`)
  } finally {
    await client.close()
  }
}

main().catch((err) => die('uncaught', err))
