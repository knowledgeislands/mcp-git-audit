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

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { loadConfig, SERVER_VERSION } from '../config/index.js'
import {
  registerRepoAuditTools,
  registerRepoCommitTools,
  registerRepoRemotesTools,
  registerRepoSyncTools
} from '../tools/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'

const config = loadConfig()

console.error(`mcp-git-audit starting...`)
console.error(`  MCP_GIT_AUDIT_SAFE_ROOTS=${config.safeRoots.join(':')}`)
console.error(`  MCP_GIT_AUDIT_ACCESS_LEVEL=${config.accessLevel}`)
console.error(
  `  MCP_GIT_AUDIT_AUDIT_LOG=${config.auditLogMode}${config.auditLogMode === 'off' ? '' : ` (path: ${config.auditLogPath})`}`
)

const createServer = (): McpServer => {
  const server = new McpServer({
    name: 'mcp-git-audit',
    version: SERVER_VERSION
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
  return server
}

const handle = serveStdio(createServer, {
  legacy: 'serve',
  onerror: (error) => console.error('mcp-git-audit stdio error:', error)
})

console.error('mcp-git-audit ready')

process.on('SIGINT', async () => {
  await handle.close()
  process.exit(0)
})
