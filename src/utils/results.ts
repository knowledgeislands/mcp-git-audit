// @ki-managed ki-repo-mcp profile=modern-v2-core version=1
import { errMessage } from './errors.js'

export const textResult = (text: string) => ({
  resultType: 'complete' as const,
  content: [{ type: 'text' as const, text }]
})

export const jsonResult = (data: unknown) => ({
  resultType: 'complete' as const,
  structuredContent: data as Record<string, unknown>,
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
})

export const errorResult = (action: string, error: unknown) => ({
  resultType: 'complete' as const,
  isError: true as const,
  content: [{ type: 'text' as const, text: `Error ${action}: ${errMessage(error)}` }]
})
