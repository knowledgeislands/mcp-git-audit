import { errMessage } from './errors.js'

export const errorResult = (action: string, error: unknown) => ({
  resultType: 'complete' as const,
  isError: true as const,
  content: [{ type: 'text' as const, text: `Error ${action}: ${errMessage(error)}` }]
})

export const jsonResult = (payload: unknown) => {
  return {
    resultType: 'complete' as const,
    structuredContent: payload as Record<string, unknown>,
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  }
}
