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

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

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

const createTransport = (safeRoot: string): StdioClientTransport =>
  new StdioClientTransport({
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
      MCP_GIT_AUDIT_SAFE_ROOTS: safeRoot
    }
  })

const main = async (): Promise<void> => {
  const safeRoot = mkdtempSync(join(tmpdir(), 'mcp-git-audit-smoke-'))
  const client = new Client(
    { name: 'mcp-git-audit-smoke', version: '0.0.0' },
    { capabilities: {}, versionNegotiation: { mode: 'auto' } }
  )

  await client.connect(createTransport(safeRoot))

  try {
    const discovery = client.getDiscoverResult()
    if (client.getProtocolEra() !== 'modern') die('server/discover did not select the modern protocol era')
    if (client.getNegotiatedProtocolVersion() !== '2026-07-28') {
      die('unexpected negotiated protocol version', client.getNegotiatedProtocolVersion())
    }
    if (
      discovery?.resultType !== 'complete' ||
      !discovery.supportedVersions.includes('2026-07-28') ||
      discovery._meta?.['io.modelcontextprotocol/serverInfo']?.name !== 'mcp-git-audit'
    ) {
      die('invalid server/discover result', discovery)
    }

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

    const scan = await client.callTool({ name: 'git_repos_scan', arguments: { root: safeRoot } })
    // The v2 client validates the required wire-level resultType, then lifts a
    // complete result into the stable callTool return shape without the discriminator.
    if (scan.isError) die('tool call returned an error envelope', scan)

    const malformed = await client.callTool({ name: 'git_repos_scan', arguments: { root: 7 } })
    if (!malformed.isError) die('malformed tool arguments were accepted', malformed)

    const legacyClient = new Client(
      { name: 'mcp-git-audit-legacy-smoke', version: '0.0.0' },
      { capabilities: {} }
    )
    await legacyClient.connect(createTransport(safeRoot))
    try {
      if (legacyClient.getProtocolEra() !== 'legacy') {
        die('legacy initialize fallback did not remain available', legacyClient.getProtocolEra())
      }
      if ((await legacyClient.listTools()).tools.length !== EXPECTED_TOOLS.length) {
        die('legacy tool surface differs from modern tool surface')
      }
    } finally {
      await legacyClient.close()
    }

    console.error(`✓ smoke passed: modern discovery, legacy fallback, ${names.length} tools, valid result envelope`)
  } finally {
    await client.close()
    rmSync(safeRoot, { recursive: true, force: true })
  }
}

main().catch((err) => die('uncaught', err))
