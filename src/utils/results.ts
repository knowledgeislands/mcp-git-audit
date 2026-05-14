export const errorResult = (message: string) => {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: message }]
  }
}

export const jsonResult = (payload: unknown) => {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  }
}
