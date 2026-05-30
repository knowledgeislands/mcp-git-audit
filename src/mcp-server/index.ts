#!/usr/bin/env node

/**
 * mcp-git-audit
 *
 * Local stdio MCP server that walks a tree of git repositories and returns
 * branch, working-tree status, ahead/behind, and last-commit metadata for each.
 *
 * Configuration (environment variables):
 *   MCP_GIT_AUDIT_SAFE_ROOTS    Colon-separated list of absolute (or ~/...) paths
 *                               that the tool is allowed to audit. Defaults to "~"
 *                               (the user's home directory) when unset or empty.
 *                               Any `root` argument must equal or live inside one of these.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from '../config/index.js'
import { registerRepoAuditTools, registerRepoCommitTools, registerRepoRemotesTools, registerRepoSyncTools } from '../tools/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'

const config = loadConfig()

console.error(`mcp-git-audit starting...`)
console.error(`  MCP_GIT_AUDIT_SAFE_ROOTS=${config.safeRoots.join(':')}`)
console.error(`  MCP_GIT_AUDIT_ACCESS_LEVEL=${config.accessLevel}`)
console.error(`  MCP_GIT_AUDIT_AUDIT_LOG=${config.auditLogMode}${config.auditLogMode === 'off' ? '' : ` (path: ${config.auditLogPath})`}`)

const server = new McpServer({
  name: 'mcp-git-audit',
  version: '1.0.0'
})
server.registerTool = makeAccessGatedRegister(server, config.accessLevel, {
  mode: config.auditLogMode,
  path: config.auditLogPath,
  maxBytes: config.auditLogMaxBytes,
  keep: config.auditLogKeep
})

registerRepoAuditTools(server, config)
registerRepoSyncTools(server, config)
registerRepoRemotesTools(server, config)
registerRepoCommitTools(server, config)

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`mcp-git-audit ready`)
}

main().catch((err) => {
  console.error('mcp-git-audit fatal:', err)
  process.exit(1)
})
