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
import { ACCESS_LEVEL, AUDIT_LOG_MODE, AUDIT_LOG_PATH, SAFE_ROOTS } from '../config.js'
import { registerRepoAuditTools } from '../tools/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'

console.error(`mcp-git-audit starting...`)
console.error(`  MCP_GIT_AUDIT_SAFE_ROOTS=${SAFE_ROOTS.join(':')}`)
console.error(`  MCP_GIT_AUDIT_ACCESS_LEVEL=${ACCESS_LEVEL}`)
console.error(`  MCP_GIT_AUDIT_AUDIT_LOG=${AUDIT_LOG_MODE}${AUDIT_LOG_MODE === 'off' ? '' : ` (path: ${AUDIT_LOG_PATH})`}`)

const server = new McpServer({
  name: 'mcp-git-audit',
  version: '1.0.0'
})
server.registerTool = makeAccessGatedRegister(server)

registerRepoAuditTools(server)

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`mcp-git-audit ready`)
}

main().catch((err) => {
  console.error('mcp-git-audit fatal:', err)
  process.exit(1)
})
