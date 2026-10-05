// @ki-managed ki-repo-mcp profile=modern-v2-core version=1
import type { McpServer, ToolAnnotations } from '@modelcontextprotocol/server'
import { ACCESS_LEVEL_RANK, type AccessLevel } from '../config/index.js'
import { type AuditConfig, withAuditLog } from './audit-log.js'

type RegisterTool = McpServer['registerTool']

interface RegisterToolConfig {
  annotations?: ToolAnnotations
}

type ToolCallback = (...callbackArgs: unknown[]) => unknown | Promise<unknown>
type RegisterToolArgs = [name: string, config: RegisterToolConfig, callback: ToolCallback]

export const levelFromAnnotations = (annotations: ToolAnnotations | undefined): AccessLevel => {
  if (annotations?.readOnlyHint === true) return 'read'
  if (annotations?.destructiveHint === true) return 'destructive'
  if (annotations?.readOnlyHint === false && annotations?.destructiveHint === false) return 'write'
  return 'destructive'
}

export const makeAccessGatedRegister = (
  server: McpServer,
  accessLevel: AccessLevel,
  audit: AuditConfig
): RegisterTool =>
  new Proxy(server.registerTool.bind(server) as RegisterTool, {
    apply(target, thisArg, args: RegisterToolArgs) {
      const [name, config, callback] = args
      const level = levelFromAnnotations(config.annotations)
      if (ACCESS_LEVEL_RANK[level] > ACCESS_LEVEL_RANK[accessLevel]) return undefined as never
      return Reflect.apply(target, thisArg, [name, config, withAuditLog(audit, name, level, callback)])
    }
  })
